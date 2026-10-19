$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $projectRoot '.local\postgres-data'
$pgCtl = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 55433 -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) {
    Write-Output 'The project PostgreSQL instance is already stopped.'
    exit 0
}

$process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listeners[0].OwningProcess)"
$expectedPath = $dataDirectory.Replace('\', '/').TrimEnd('/')
$actualCommand = $process.CommandLine.Replace('\', '/')
if ($process.Name -ne 'postgres.exe' -or $actualCommand -notlike "*$expectedPath*") {
    throw 'Port 55433 is not owned by this project PostgreSQL data directory; refusing to stop it.'
}

& $pgCtl -D $dataDirectory -m fast -w stop
if ($LASTEXITCODE -ne 0) {
    throw "Project PostgreSQL failed to stop cleanly (exit code $LASTEXITCODE)."
}
Write-Output 'Stopped the project PostgreSQL instance.'
