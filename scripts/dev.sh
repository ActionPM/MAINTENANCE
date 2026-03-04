#!/usr/bin/env bash
set -e

PORT=3000
cd "$(dirname "$0")/.."

# Force-kill anything on port 3000 so Next.js doesn't auto-increment
fuser -k $PORT/tcp 2>/dev/null || true
sleep 1

# Generate JWT using plain Node crypto (no external deps)
TOKEN=$(node -e "
const crypto = require('crypto');
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const h = b64url({ alg: 'HS256', typ: 'JWT' });
const p = b64url({ sub: 'tenant-user-1', account_id: 'acct-1', unit_ids: ['unit-101','unit-202'], iat: now, exp: now + 3600, iss: 'wo-agent', aud: 'wo-agent' });
const sig = crypto.createHmac('sha256', 'dev-access-secret-at-least-32-characters!!').update(h+'.'+p).digest('base64url');
process.stdout.write(h+'.'+p+'.'+sig);
")

# Write a launcher page that loads the app in an iframe with the token.
# Uses .htm (not .html) because Next.js App Router intercepts .html files.
mkdir -p apps/web/public
cat > apps/web/public/dev.htm <<HTMLEOF
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dev Launcher</title>
<style>*{margin:0;padding:0}iframe{width:100vw;height:100vh;border:none}</style>
</head><body>
<iframe src="/?token=${TOKEN}&units=unit-101,unit-202"></iframe>
</body></html>
HTMLEOF

# Start Next.js dev server on the exact port
pnpm --filter @wo-agent/web exec next dev -p $PORT &
DEV_PID=$!

# Wait for server
printf "Waiting for dev server"
until curl -s -o /dev/null http://localhost:$PORT 2>/dev/null; do
  printf "."
  sleep 1
done
echo " ready!"

# Build URL
if [ -n "$CODESPACE_NAME" ]; then
  URL="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}/dev.htm"
else
  URL="http://localhost:${PORT}/dev.htm"
fi

echo ""
echo "  $URL"
echo ""
echo "  Ctrl+C to stop"

trap "rm -f apps/web/public/dev.htm apps/web/public/dev.html" EXIT
wait $DEV_PID
