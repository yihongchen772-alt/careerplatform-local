param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir
$localUrl = 'http://127.0.0.1:3000'
$existing = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $existing) {
    & npm.cmd run local:setup
    if ($LASTEXITCODE -ne 0) { throw 'Database setup failed.' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectDir '.next/standalone/server.js'))) {
        & node.exe scripts/packaging-build.cjs
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    }
    $logDir = Join-Path $projectDir '.local-run'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $nodeExecutable = (Get-Command node.exe).Source
    $nextExecutable = Join-Path $projectDir 'scripts/local-server.cjs'
    $server = Start-Process -FilePath $nodeExecutable -ArgumentList @(('"' + $nextExecutable + '"')) -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log') -PassThru
    $server.Id | Set-Content -LiteralPath (Join-Path $logDir 'server.pid')
}
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri "$localUrl/dashboard" -UseBasicParsing -TimeoutSec 3
        $brand = '{0}{1}' -f [char]0x6c42, [char]0x804c
        if ($response.StatusCode -eq 200 -and $response.Content -match $brand) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'App did not start. Check port 3000 and .local-run/server-error.log.' }
Write-Host "Career platform is ready: $localUrl"
if (-not $NoBrowser) { Start-Process $localUrl }
