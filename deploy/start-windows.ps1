$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$logs = Join-Path $projectRoot 'server/data/logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
try {
    $server = Start-Process -FilePath "$env:ProgramFiles/nodejs/node.exe" -ArgumentList '--env-file=.env', 'server/src/index.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput "$logs/server-$runId.log" -RedirectStandardError "$logs/server-$runId-error.log" -Wait -PassThru
    exit $server.ExitCode
} catch {
    $_ | Out-String | Add-Content "$logs/startup-error.log"
    exit 1
}
