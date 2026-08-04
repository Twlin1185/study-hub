<#
    run-tests.ps1 -- Study Hub backend test runner (token-lean output).

    The project ships an embeddable Python (python-embed/python312._pth), which
    keeps cwd and PYTHONPATH out of sys.path, so plain "python -m pytest" fails
    to import backend modules. This wrapper injects sys.path and trims output to
    the summary so a full run costs a few lines of context instead of hundreds.

    ASCII-only on purpose: Windows PowerShell 5.1 decodes BOM-less .ps1 as ANSI.

    Usage:
      powershell -ExecutionPolicy Bypass -File scripts/run-tests.ps1
      powershell -ExecutionPolicy Bypass -File scripts/run-tests.ps1 -Path tests/test_sm2.py
      powershell -ExecutionPolicy Bypass -File scripts/run-tests.ps1 -Full   # full output when debugging
#>
[CmdletBinding()]
param(
    [string]$Path = '',
    [switch]$Full
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root 'python-embed\python.exe'
$backend = Join-Path $root 'backend'

if (-not (Test-Path $python)) {
    Write-Output "ERROR: embedded python not found at $python"
    exit 2
}

$pytestArgs = @("'-q'", "'--tb=line'", "'-p'", "'no:warnings'")
if ($Path) { $pytestArgs += "'$Path'" }
$argList = $pytestArgs -join ', '
$code = "import sys; sys.path.insert(0, ''); import pytest; raise SystemExit(pytest.main([$argList]))"

Push-Location $backend
try {
    $output = & $python -c $code
    $exit = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($Full) {
    $output | ForEach-Object { Write-Output $_ }
}
else {
    # Keep failure lines (--tb=line emits one line per failure) and the summary.
    $keep = $output | Where-Object { $_ -match 'failed|error|passed|FAILED|ERROR|assert' }
    if ($keep) { $keep | Select-Object -Last 25 | ForEach-Object { Write-Output $_ } }
    else { $output | Select-Object -Last 3 | ForEach-Object { Write-Output $_ } }
}

exit $exit
