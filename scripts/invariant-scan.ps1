<#
    invariant-scan.ps1 -- Study Hub invariant rule scanner (CLAUDE.md rules 1-5).

    Purpose: replace the reviewer's manual grep sweep with one deterministic run,
    so the Opus reviewer reads a short summary instead of raw grep output.

    Output is ASCII-only on purpose: Windows PowerShell 5.1 decodes .ps1 files as
    ANSI when there is no BOM, so non-ASCII literals here would be garbled.

    Usage:
      powershell -ExecutionPolicy Bypass -File scripts/invariant-scan.ps1
      powershell -ExecutionPolicy Bypass -File scripts/invariant-scan.ps1 -UpdateBaseline

    Exit code: 0 = no new violations, 1 = new or increased violations.
#>
[CmdletBinding()]
param(
    [switch]$UpdateBaseline,
    [switch]$Detail
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$baselinePath = Join-Path $PSScriptRoot 'invariant-baseline.json'

# --- check definitions -------------------------------------------------------
# mode 'zero'     : any hit is a violation (hard invariant, must stay at 0)
# mode 'baseline' : hits are compared against the recorded baseline per file
$checks = @(
    @{
        Id      = 'answer-leak-schema'
        Rule    = 'Rule 1 - quiz/session schemas must not declare answer/explanation fields'
        Mode    = 'zero'
        Files   = @('backend/schemas/quiz.py', 'backend/schemas/study.py')
        Pattern = '^\s*[A-Za-z_]*(?:answer|explanation)[A-Za-z_]*\s*:'
    },
    @{
        Id      = 'answer-leak-router'
        Rule    = 'Rule 1 - quiz/study routers must not touch correct_answer/explanation'
        Mode    = 'zero'
        Files   = @('backend/routers/quiz.py', 'backend/routers/study.py')
        Pattern = 'correct_answer|\.explanation'
    },
    @{
        Id      = 'attempt-transaction'
        Rule    = 'Rule 2 - attempt_service must commit exactly once (single transaction)'
        Mode    = 'exact'
        Expect  = 1
        Files   = @('backend/services/attempt_service.py')
        Pattern = '\.commit\(\)'
    },
    @{
        Id      = 'physical-delete'
        Rule    = 'Rule 3 - physical DELETE (documents must be soft-deleted via is_active=0)'
        Mode    = 'baseline'
        Roots   = @('backend/services', 'backend/routers')
        Include = @('*.py')
        Pattern = 'db\.delete\(|__table__\.delete\(\)|DELETE\s+FROM'
    },
    @{
        Id      = 'fs-mutate'
        Rule    = 'Rule 4 - filesystem removal/move calls (sources/ originals are immutable)'
        Mode    = 'baseline'
        Roots   = @('backend/services', 'backend/routers')
        Include = @('*.py')
        Pattern = 'os\.remove\(|\.unlink\(|shutil\.rmtree\(|shutil\.move\('
    },
    @{
        Id      = 'hardcoded-color'
        Rule    = 'Rule 5 - hardcoded colors outside styles/tokens.css'
        Mode    = 'baseline'
        Roots   = @('frontend/src')
        Include = @('*.ts', '*.tsx', '*.css')
        Exclude = @('tokens.css')
        Pattern = '#[0-9a-fA-F]{3,8}\b|rgba?\('
        SkipComments = $true
    }
)

# --- collection --------------------------------------------------------------
function Get-TargetFiles {
    param($check)
    $result = @()
    if ($check.ContainsKey('Files')) {
        foreach ($rel in $check.Files) {
            $p = Join-Path $root $rel
            if (Test-Path $p) { $result += Get-Item $p }
        }
        return $result
    }
    foreach ($r in $check.Roots) {
        $p = Join-Path $root $r
        if (-not (Test-Path $p)) { continue }
        $found = Get-ChildItem -Path $p -Recurse -File -Include $check.Include
        foreach ($f in $found) {
            if ($f.FullName -match '__pycache__|node_modules|\\dist\\|\\.venv') { continue }
            if ($check.ContainsKey('Exclude')) {
                $skip = $false
                foreach ($ex in $check.Exclude) { if ($f.Name -eq $ex) { $skip = $true } }
                if ($skip) { continue }
            }
            $result += $f
        }
    }
    return $result
}

$report = @{}
$hitDetail = @{}

foreach ($check in $checks) {
    $files = Get-TargetFiles $check
    $perFile = @{}
    $lines = @()
    foreach ($f in $files) {
        $matches = Select-String -Path $f.FullName -Pattern $check.Pattern -AllMatches
        if (-not $matches) { continue }
        $kept = @()
        foreach ($m in $matches) {
            if ($check.SkipComments) {
                $t = $m.Line.TrimStart()
                if ($t.StartsWith('//') -or $t.StartsWith('*') -or $t.StartsWith('/*')) { continue }
            }
            $kept += $m
        }
        if ($kept.Count -eq 0) { continue }
        $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
        $perFile[$rel] = $kept.Count
        foreach ($m in $kept) { $lines += ("{0}:{1}: {2}" -f $rel, $m.LineNumber, $m.Line.Trim()) }
    }
    $report[$check.Id] = $perFile
    $hitDetail[$check.Id] = $lines
}

# --- baseline update ---------------------------------------------------------
if ($UpdateBaseline) {
    $report | ConvertTo-Json -Depth 5 | Out-File -FilePath $baselinePath -Encoding utf8
    Write-Output "baseline written: $baselinePath"
    foreach ($check in $checks) {
        $n = ($report[$check.Id].Values | Measure-Object -Sum).Sum
        if (-not $n) { $n = 0 }
        Write-Output ("  {0,-22} {1} hit(s) in {2} file(s)" -f $check.Id, $n, $report[$check.Id].Count)
    }
    exit 0
}

$baseline = $null
if (Test-Path $baselinePath) {
    $baseline = Get-Content $baselinePath -Raw -Encoding UTF8 | ConvertFrom-Json
}

# --- verdict -----------------------------------------------------------------
$violations = @()

foreach ($check in $checks) {
    $perFile = $report[$check.Id]
    $total = ($perFile.Values | Measure-Object -Sum).Sum
    if (-not $total) { $total = 0 }

    switch ($check.Mode) {
        'zero' {
            if ($total -gt 0) {
                $violations += [pscustomobject]@{ Check = $check.Id; Rule = $check.Rule; Detail = "$total hit(s), expected 0" }
            }
        }
        'exact' {
            if ($total -ne $check.Expect) {
                $violations += [pscustomobject]@{ Check = $check.Id; Rule = $check.Rule; Detail = "$total occurrence(s), expected $($check.Expect)" }
            }
        }
        'baseline' {
            $base = $null
            if ($baseline -and $baseline.PSObject.Properties.Name -contains $check.Id) { $base = $baseline.$($check.Id) }
            foreach ($file in $perFile.Keys) {
                $wasCount = 0
                if ($base -and ($base.PSObject.Properties.Name -contains $file)) { $wasCount = [int]$base.$file }
                $now = [int]$perFile[$file]
                if ($now -gt $wasCount) {
                    $violations += [pscustomobject]@{ Check = $check.Id; Rule = $check.Rule; Detail = "$file : $wasCount -> $now" }
                }
            }
        }
    }
}

Write-Output "== Study Hub invariant scan =="
foreach ($check in $checks) {
    $perFile = $report[$check.Id]
    $total = ($perFile.Values | Measure-Object -Sum).Sum
    if (-not $total) { $total = 0 }
    Write-Output ("  {0,-22} {1,4} hit(s) / {2} file(s)   [{3}]" -f $check.Id, $total, $perFile.Count, $check.Mode)
}

if ($Detail) {
    Write-Output ""
    Write-Output "== hit detail =="
    foreach ($check in $checks) {
        foreach ($l in $hitDetail[$check.Id]) { Write-Output ("  [{0}] {1}" -f $check.Id, $l) }
    }
}

Write-Output ""
if ($violations.Count -eq 0) {
    if (-not $baseline) {
        Write-Output "RESULT: no baseline recorded yet - run with -UpdateBaseline to freeze the current state."
    }
    Write-Output "RESULT: PASS - no new invariant violations."
    exit 0
}

Write-Output ("RESULT: FAIL - {0} new violation(s)." -f $violations.Count)
foreach ($v in $violations) {
    Write-Output ("  [{0}] {1}" -f $v.Check, $v.Rule)
    Write-Output ("      {0}" -f $v.Detail)
}
exit 1
