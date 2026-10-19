$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $projectRoot '.local\postgres-data'
$logFile = Join-Path $projectRoot '.local\postgres.log'
$pgCtl = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
$postgresExe = 'C:\Program Files\PostgreSQL\18\bin\postgres.exe'

if (-not (Test-Path -LiteralPath $dataDirectory)) {
    throw 'The isolated project PostgreSQL data directory is missing. See the README setup section before initializing it.'
}

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 55433 -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listeners[0].OwningProcess)"
    $expectedPath = $dataDirectory.Replace('\', '/').TrimEnd('/')
    $actualCommand = $process.CommandLine.Replace('\', '/')
    if ($process.Name -eq 'postgres.exe' -and $actualCommand -like "*$expectedPath*") {
        Write-Output 'The project PostgreSQL instance is already running on 127.0.0.1:55433.'
        exit 0
    }
    throw 'Port 55433 is occupied by a different process; the project database was not started.'
}

if (-not (Test-Path -LiteralPath $pgCtl) -or -not (Test-Path -LiteralPath $postgresExe)) {
    throw 'PostgreSQL 18 command-line tools were not found in the expected installation directory.'
}

& $pgCtl -D $dataDirectory -l $logFile -o '-h 127.0.0.1 -p 55433' -w start
if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL failed to start (exit code $LASTEXITCODE). Check .local\postgres.log."
}
Write-Output 'Project PostgreSQL is listening on 127.0.0.1:55433.'
