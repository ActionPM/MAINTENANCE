param(
  [string]$LogPath = "apps/web/.next-dev.log",
  [int]$Tail = 400,
  [int]$LastRequests = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-EventProp {
  param(
    [object]$Event,
    [string]$Name
  )

  $prop = $Event.PSObject.Properties[$Name]
  if ($null -eq $prop) {
    return $null
  }
  return $prop.Value
}

if (-not (Test-Path -LiteralPath $LogPath)) {
  Write-Error "Log file not found: $LogPath"
}

$lines = Get-Content -LiteralPath $LogPath -Tail $Tail
$jsonEvents = @()

foreach ($line in $lines) {
  $trimmed = $line.Trim()
  if (-not $trimmed.StartsWith('{')) {
    continue
  }

  try {
    $jsonEvents += ($trimmed | ConvertFrom-Json)
  } catch {
    continue
  }
}

if ($jsonEvents.Count -eq 0) {
  Write-Output "No structured JSON events found in $LogPath"
  exit 0
}

$grouped = $jsonEvents |
  Where-Object { $_.request_id } |
  Group-Object -Property request_id |
  Sort-Object {
    $last = $_.Group | Sort-Object {
      if ($_.timestamp) { [datetime]$_.timestamp } else { [datetime]::MinValue }
    } | Select-Object -Last 1
    if ($last.timestamp) { [datetime]$last.timestamp } else { [datetime]::MinValue }
  } -Descending |
  Select-Object -First $LastRequests

foreach ($group in $grouped) {
  $events = $group.Group | Sort-Object {
    if ($_.timestamp) { [datetime]$_.timestamp } else { [datetime]::MinValue }
  }
  $first = $events | Select-Object -First 1
  $last = $events | Select-Object -Last 1

  $firstRoute = Get-EventProp $first 'route'
  $firstMethod = Get-EventProp $first 'method'
  $firstTimestamp = Get-EventProp $first 'timestamp'
  $lastStatus = Get-EventProp $last 'status'

  Write-Output ""
  Write-Output ("Request {0}" -f $group.Name)
  if ($firstRoute) {
    Write-Output ("  Route: {0}" -f $firstRoute)
  }
  if ($firstMethod) {
    Write-Output ("  Method: {0}" -f $firstMethod)
  }
  if ($firstTimestamp) {
    Write-Output ("  Started: {0}" -f $firstTimestamp)
  }
  if ($lastStatus) {
    Write-Output ("  Final status: {0}" -f $lastStatus)
  }

  foreach ($event in $events) {
    $parts = @()
    $timestamp = Get-EventProp $event 'timestamp'
    $component = Get-EventProp $event 'component'
    $eventName = Get-EventProp $event 'event'
    $route = Get-EventProp $event 'route'
    $actionType = Get-EventProp $event 'action_type'
    $toolName = Get-EventProp $event 'tool_name'
    $stateBefore = Get-EventProp $event 'state_before'
    $stateAfter = Get-EventProp $event 'state_after'
    $status = Get-EventProp $event 'status'
    $durationMs = Get-EventProp $event 'duration_ms'
    $errorCode = Get-EventProp $event 'error_code'
    $errorMessage = Get-EventProp $event 'error_message'

    if ($timestamp) { $parts += $timestamp }
    if ($component) { $parts += "[{0}]" -f $component }
    if ($eventName) { $parts += $eventName }
    if ($route) { $parts += "route={0}" -f $route }
    if ($actionType) { $parts += "action={0}" -f $actionType }
    if ($toolName) { $parts += "tool={0}" -f $toolName }
    if ($stateBefore) { $parts += "from={0}" -f $stateBefore }
    if ($stateAfter) { $parts += "to={0}" -f $stateAfter }
    if ($status) { $parts += "status={0}" -f $status }
    if ($durationMs) { $parts += "duration_ms={0}" -f $durationMs }
    if ($errorCode) { $parts += "error_code={0}" -f $errorCode }
    Write-Output ("  - {0}" -f ($parts -join " "))

    if ($errorMessage) {
      Write-Output ("    error: {0}" -f $errorMessage)
    }
  }
}
