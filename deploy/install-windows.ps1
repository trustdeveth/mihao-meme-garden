$ErrorActionPreference = 'Stop'
$taskName = 'MihaoMemeGarden'
$port = 8892
$config = 'C:/caddy/Caddyfile'
$caddy = 'C:/caddy/caddy.exe'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw "$taskName task already exists; inspect before updating." }
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port is occupied." }
$current = [IO.File]::ReadAllText($config)
if ($current -match '(?m)^[^#\r\n]*\bmihaomeme\.garden\b') { throw 'Domain already configured.' }
$addition = @'

mihaomeme.garden, www.mihaomeme.garden {
    encode gzip zstd
    reverse_proxy 127.0.0.1:8892
}
'@
$candidate = Join-Path $PSScriptRoot 'Caddyfile.windows.candidate'
[IO.File]::WriteAllText($candidate, $current + "`r`n" + $addition + "`r`n", [Text.UTF8Encoding]::new($false))
& $caddy validate --config $candidate --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Caddy validation failed.' }
$script = Join-Path $PSScriptRoot 'start-windows.ps1'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$triggers = @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $taskName
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $page = Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 3
        if ($page.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 1 }
}
if (!$ready) { throw 'Game startup failed; proxy configuration unchanged. Check server/data/logs.' }
if ([IO.File]::ReadAllText($config) -ne $current) { throw 'Caddy changed during installation; inspect and retry manually.' }
$backup = $config + '.bak-mihao-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
Copy-Item -LiteralPath $config -Destination $backup
Copy-Item -LiteralPath $candidate -Destination $config
& $caddy reload --config $config --adapter caddyfile
if ($LASTEXITCODE -ne 0) {
    Copy-Item -LiteralPath $backup -Destination $config
    throw "Reload failed; restored $backup."
}
Write-Output "Mihao Meme Garden running on 127.0.0.1:$port. Caddy backup: $backup"
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
