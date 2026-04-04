**Role type:** critic

- **Primary purpose:** ensure the UI reflects server-authoritative auth and scope truth
- **Owns:** session-expiry handling, step-up prompts, privileged action gating, permission-aware visibility rules, unauthorized-context clearing
- **Must never own:** IdP selection, server enforcement code, general UX ownership
- **When to invoke:** every auth/session/scope/workflow/export change; medium/high-risk UI changes
- **Typical inputs:** access model, session model, workflow actions, route map, diff
- **Typical outputs:** `security-review.md`, `access-state-matrix.md`, `session-state-diagram.md`
- **Division logic:** DIV 08, DIV 03, DIV 02
- **Who reviews it:** Quality agent on high-risk changes; Governance on scope exceptions
- **Hard rule:** no privileged action without explicit reauth path where required
- **Recommended default:** Security is always a critic, and becomes co-designer on auth-sensitive work
- **Future-state option:** later add a deeper appsec lane
