$ErrorActionPreference = 'Stop'
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entry = Join-Path $projectDir 'bridge\server.mjs'
$runtimeDir = Join-Path $projectDir '.runtime'
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $runtimeDir 'bridge-config.json'))) {
    & $nodePath $entry --init
    if ($LASTEXITCODE -ne 0) { throw 'Bridge initialization failed' }
}
$pidPath = Join-Path $runtimeDir 'bridge.pid'
if (Test-Path -LiteralPath $pidPath) {
    $savedPid = [int]([IO.File]::ReadAllText($pidPath).Trim())
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid"
    if ($existing -and $existing.Name -eq 'node.exe' -and $existing.CommandLine.Contains($entry)) {
        Write-Output 'Bridge is already running'
        exit 0
    }
}
$process = Start-Process -FilePath $nodePath -ArgumentList ('"' + $entry + '"') -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'bridge.stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'bridge.stderr.log') -PassThru
[IO.File]::WriteAllText($pidPath, [string]$process.Id)
Write-Output ('Bridge process started: ' + $process.Id)
