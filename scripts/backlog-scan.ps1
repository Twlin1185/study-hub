<#
    backlog-scan.ps1 -- Study Hub remaining-work scanner.

    Purpose: /stage-status must answer "what is left" from the SOURCE documents
    (roadmap M, features F, decisions D, risks R, feedback FB) and the stage
    checkboxes -- not from stage docs alone (a stage is written only AFTER the
    work has been chosen). This script does that sweep deterministically and
    compares the result with the registry docs/01-plan/backlog.md so the main
    conversation reads a short summary instead of grepping five documents.

    This file is saved WITH a UTF-8 BOM on purpose: it contains Korean regex
    literals and Windows PowerShell 5.1 decodes BOM-less .ps1 files as ANSI.
    (Re-add the BOM if an editor strips it: scripts/backlog-scan.ps1 header.)

    Usage:
      powershell -ExecutionPolicy Bypass -File scripts/backlog-scan.ps1
      powershell -ExecutionPolicy Bypass -File scripts/backlog-scan.ps1 -Detail

    Exit code: 0 = registry consistent with sources, 1 = drift found
               (open item not registered, or registered item whose source looks closed).
#>
[CmdletBinding()]
param(
    [switch]$Detail
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
$planDir = Join-Path $root 'docs\01-plan'

function ReadLines($path) { Get-Content -LiteralPath $path -Encoding UTF8 }
function Clip([string]$s, [int]$n = 100) {
    $s = ($s -replace '\*\*', '' -replace '\s+', ' ').Trim()
    if ($s.Length -gt $n) { return $s.Substring(0, $n) + '…' }
    return $s
}
function Cells([string]$line) {
    $inner = $line.Trim() -replace '^\|', '' -replace '\|$', ''
    return [regex]::Split($inner, '(?<!\\)\|') | ForEach-Object { $_.Trim() }
}
function LastMarker([string]$cell, [int]$n = 110) {
    # the newest status note in a row is conventionally appended as "← ..." ; fall back to the tail
    $m = [regex]::Matches($cell, '←[^←]*$')
    if ($m.Count -gt 0) { return Clip $m[0].Value $n }
    if ($cell.Length -gt $n) { return '…' + (Clip $cell.Substring($cell.Length - $n) $n) }
    return Clip $cell $n
}

$openSourceIds = New-Object System.Collections.Generic.HashSet[string]
$closedSourceIds = New-Object System.Collections.Generic.HashSet[string]
$openHint = '대기|이월|보류|착수 금지|미편성|등재만|후속 등재|범위 밖|재론|감시|재현 시 보고|후보'

# ---------------------------------------------------------------- 0. registry (docs/01-plan/backlog.md)
# Loaded first: a "종결" row in the registry overrides the source heuristics (the registry is the arbiter),
# so the OPEN lists below show only what is really left.
$blPath = Join-Path $planDir 'backlog.md'
$registered = New-Object System.Collections.Generic.HashSet[string]
$closedByRegistry = New-Object System.Collections.Generic.HashSet[string]
$activeRows = @(); $blRowCount = 0; $registryMissing = -not (Test-Path -LiteralPath $blPath)
if (-not $registryMissing) {
    $blRows = @((ReadLines $blPath) | Where-Object { $_ -match '^\| ' -and $_ -notmatch '^\| ID \|' -and $_ -notmatch '^\|---' })
    $blRowCount = $blRows.Count
    foreach ($r in $blRows) {
        $c = Cells $r
        if ($c.Count -lt 5) { continue }
        $ids = @([regex]::Matches(($c[0] + ' ' + $c[1]), '(FB-\d+|D\d+|R\d+|F\d+|M\d+)') | ForEach-Object { $_.Value })
        foreach ($id in $ids) { [void]$registered.Add($id) }
        if ($c[4] -match '종결') { foreach ($id in $ids) { [void]$closedByRegistry.Add($id) } }
        else { $activeRows += [pscustomobject]@{ Id = $c[0]; Ids = $ids; Status = $c[4] } }
    }
}
function RegClosed([string]$id) { return $closedByRegistry.Contains($id) }

# ---------------------------------------------------------------- 1. stages
$stageFiles = Get-ChildItem -LiteralPath $planDir -Filter 'stage-*.plan.md' |
    Sort-Object { [int]([regex]::Match($_.Name, 'stage-(\d+)').Groups[1].Value) }
$done = 0; $inProgress = @(); $notStarted = @()
foreach ($f in $stageFiles) {
    $n = [regex]::Match($f.Name, 'stage-(\d+)').Groups[1].Value
    $lines = ReadLines $f.FullName
    $x = @($lines | Where-Object { $_ -match '^\s*- \[x\]' }).Count
    $o = @($lines | Where-Object { $_ -match '^\s*- \[ \]' }).Count
    $title = Clip (($lines[0] -replace '^\xEF\xBB\xBF', '') -replace '^#\s*', '') 70
    if ($o -eq 0) { $done++ }
    elseif ($x -eq 0) { $notStarted += "stage-$n ($title, 0/$o)" }
    else {
        $inProgress += [pscustomobject]@{ N = $n; Title = $title; X = $x; O = $o
            Open = @($lines | Where-Object { $_ -match '^\s*- \[ \]' }) }
    }
}
Write-Output ("[STAGE] total {0} | done {1} | in-progress {2} | not-started {3}" -f $stageFiles.Count, $done, $inProgress.Count, $notStarted.Count)
foreach ($s in $inProgress) {
    Write-Output ("  IN-PROGRESS stage-{0} {1} [{2}/{3}]" -f $s.N, $s.Title, $s.X, ($s.X + $s.O))
    foreach ($l in $s.Open) { Write-Output ("    " + $l.Trim()) }
}
foreach ($s in $notStarted) { Write-Output ("  NOT-STARTED " + $s) }

# ---------------------------------------------------------------- 2. master plan (M / F / R)
$mp = ReadLines (Join-Path $planDir 'study-app.plan.md')
$mRows = @($mp | Where-Object { $_ -match '^\| \*\*M\d+\.' })
$mOpen = @($mRows | Where-Object { $_ -notmatch '✅' })
Write-Output ("[M] roadmap rows {0} | open {1}" -f $mRows.Count, $mOpen.Count)
foreach ($r in $mOpen) { $c = Cells $r; Write-Output ("  OPEN " + (Clip $c[0] 40) + " -- " + (Clip $c[1] 80)) }

$fRows = @($mp | Where-Object { $_ -match '^\| F\d+ \|' })
$fUnassigned = @()
foreach ($r in $fRows) {
    $c = Cells $r
    if ($c.Count -ge 4 -and $c[$c.Count - 1] -notmatch 'M\d+' -and $c[$c.Count - 1] -notmatch '^S\d+') { $fUnassigned += $c[0] }
}
Write-Output ("[F] feature rows {0} | without milestone/stage {1}" -f $fRows.Count, $fUnassigned.Count)
foreach ($id in $fUnassigned) { Write-Output ("  UNASSIGNED " + $id) }
$cand = @($mp | Where-Object { $_ -match 'v1\.x 후보\(로드맵 미배정' })
foreach ($l in $cand) { Write-Output ("  CANDIDATE-NOTE " + (Clip $l 200)) }

$rRows = @($mp | Where-Object { $_ -match '^\| R[\d~R]+ \|' })
$rOpen = @(); $rClosed = 0
foreach ($r in $rRows) {
    $c = Cells $r
    if ($c[1] -match '\(종결' -or (RegClosed $c[0])) { $rClosed++; [void]$closedSourceIds.Add($c[0]); continue }
    $rOpen += , $c
    if ($c[0] -notmatch '~') { [void]$openSourceIds.Add($c[0]) }
}
Write-Output ("[R] master §15 rows {0} | closed {1} | open {2}" -f $rRows.Count, $rClosed, $rOpen.Count)
foreach ($c in $rOpen) {
    $label = 'OPEN'; if ($c[0] -match '~') { $label = 'INDEX' }
    Write-Output ("  {0,-7} {1} -- {2}" -f $label, $c[0], (Clip $c[1] 70))
}

# ---------------------------------------------------------------- 3. editor-v2 annex (D / R33~R41 / FB / carry-over)
$ev = ReadLines (Join-Path $planDir 'editor-v2.plan.md')
$dRows = @($ev | Where-Object { $_ -match '^\| D\d+ \|' })
Write-Output ("[D] decisions {0}" -f $dRows.Count)
foreach ($r in $dRows) {
    $c = Cells $r
    $tail = LastMarker $c[2]
    $hint = 'closed'
    if ($tail -match $openHint -and $tail -notmatch '재론 없음|완전 종결' -and -not (RegClosed $c[0])) { $hint = 'OPEN?' }
    if ($hint -eq 'OPEN?') { [void]$openSourceIds.Add($c[0]) } else { [void]$closedSourceIds.Add($c[0]) }
    if ($hint -eq 'OPEN?' -or $Detail) { Write-Output ("  {0,-7} {1} -- {2}" -f $hint, $c[0], $tail) }
}

$sec9 = $false; $evR = @()
foreach ($l in $ev) {
    if ($l -match '^## 9\.') { $sec9 = $true; continue }
    if ($l -match '^## 10\.') { $sec9 = $false }
    if ($sec9 -and $l -match '^\| R\d+ \|') { $evR += $l }
}
Write-Output ("[R] annex §9 rows {0}" -f $evR.Count)
foreach ($r in $evR) {
    $c = Cells $r
    $closed = ($c[2] -match '완결|종결') -or (RegClosed $c[0])
    $tail = LastMarker $c[2] 90
    if ($closed) { [void]$closedSourceIds.Add($c[0]) } else { [void]$openSourceIds.Add($c[0]) }
    $label = 'OPEN'; if ($closed) { $label = 'closed' }
    if (-not $closed -or $Detail) { Write-Output ("  {0,-7} {1} -- {2}" -f $label, $c[0], $tail) }
}

$fbRows = @($ev | Where-Object { $_ -match '^\| FB-\d+ \|' })
$fbOut = @(); $fbOpen = 0
foreach ($r in $fbRows) {
    $c = Cells $r
    $tail = LastMarker $c[3] 400   # newest "← ..." note decides; the registry is the final arbiter
    $resolved = ($tail -match '완료|해소|종결|착수|편입|편성|D11')
    if ($tail -match '미편성|등재만|착수 금지|감시|재현 시 보고|이월|후속 등재|범위 밖|잔여') { $resolved = $false }
    if (RegClosed $c[0]) { $resolved = $true }
    if ($resolved) { [void]$closedSourceIds.Add($c[0]) } else { $fbOpen++; [void]$openSourceIds.Add($c[0]) }
    $label = 'OPEN'; if ($resolved) { $label = 'closed' }
    if (-not $resolved -or $Detail) { $fbOut += ("  {0,-7} {1} [{2}] -- {3}" -f $label, $c[0], (Clip $c[1] 12), (Clip $tail 110)) }
}
Write-Output ("[FB] feedback rows {0} | open {1}" -f $fbRows.Count, $fbOpen)
foreach ($l in $fbOut) { Write-Output $l }

$carry = @()
$inCarry = $false
foreach ($l in $ev) {
    if ($l -match '^\*\*2026-09-01') { $inCarry = $true; continue }
    if ($inCarry -and $l -match '^\*\*20\d\d-') { $inCarry = $false }
    if ($inCarry -and $l -match '^- \*\*') { $carry += $l }
}
foreach ($l in $carry) { Write-Output ("  CARRY-OVER " + (Clip $l 110)) }
$s73 = @($ev | Where-Object { $_ -match '^### 7\.3' })
if ($s73.Count -gt 0) { Write-Output ("  ANNEX §7.3 v2.x deferred: 캡처 파이프라인(설계만 — 구현은 후속 계획서)") }

# ---------------------------------------------------------------- 4. registry compare
$drift = 0
if ($registryMissing) {
    Write-Output "[REGISTRY] docs/01-plan/backlog.md MISSING"
    $drift = 1
} else {
    $unregistered = @($openSourceIds | Where-Object { -not $registered.Contains($_) } | Sort-Object)
    # CHECK-CLOSED: an active registry row whose FB/R ids all read as closed in the sources.
    # D ids are excluded on purpose -- a settled decision routinely leaves implementation work open.
    $checkClosed = @()
    foreach ($row in $activeRows) {
        $ids = @($row.Ids | Where-Object { $_ -match '^(FB-|R)' })
        if ($ids.Count -eq 0) { continue }
        $anyOpen = $false; $anyKnown = $false
        foreach ($id in $ids) {
            if ($openSourceIds.Contains($id)) { $anyOpen = $true }
            # closed by the SOURCE text only -- a parent id the registry itself closed (e.g. FB-2 done,
            # FB-2-잔여 still open) is a deliberate split, not drift
            if ($closedSourceIds.Contains($id) -and -not $closedByRegistry.Contains($id)) { $anyKnown = $true }
        }
        if (-not $anyOpen -and $anyKnown) { $checkClosed += $row.Id }
    }
    Write-Output ("[REGISTRY] backlog.md rows {0} | active {1} | closed {2} | unregistered-open {3} | registered-but-source-closed {4}" -f $blRowCount, $activeRows.Count, ($blRowCount - $activeRows.Count), $unregistered.Count, $checkClosed.Count)
    foreach ($id in $unregistered) { Write-Output ("  UNREGISTERED " + $id); $drift = 1 }
    foreach ($id in $checkClosed) { Write-Output ("  CHECK-CLOSED " + $id); $drift = 1 }
    $byStatus = ($activeRows | Group-Object { ($_.Status -split '[(（ —]')[0] } | ForEach-Object { "{0}={1}" -f $_.Name, $_.Count }) -join ' | '
    Write-Output ("  active by status: " + $byStatus)
    foreach ($row in ($activeRows | Where-Object { $_.Status -match '^(미편성|확정 대기|미배정)' })) {
        Write-Output ("  TODO  {0,-18} {1}" -f (Clip $row.Id 18), (Clip $row.Status 40))
    }
}

if ($drift -eq 0) { Write-Output "RESULT: PASS (registry consistent)" } else { Write-Output "RESULT: DRIFT (see UNREGISTERED / CHECK-CLOSED / MISSING above)" }
exit $drift
