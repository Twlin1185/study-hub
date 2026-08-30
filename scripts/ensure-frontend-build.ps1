# 프론트 빌드가 최신이 아니면 빌드한다 — 1_Setup.bat · 2_StartServer.bat · Dev_StartServer.bat 공용.
#
# 판정은 frontend\scripts\source-hash.mjs(소스 내용 해시 vs dist\.source-hash) 한 곳에서만 한다.
# node/npm이 없는 PC(테스터·포터블)는 조용히 건너뛴다 — 저장소에 든 dist를 그대로 쓴다.
#
# exit 0 = 최신 / 빌드 성공 / 건너뜀(도구 없음)
# exit 1 = 빌드 또는 npm install 실패(호출자가 안내 후 계속할지 결정)
param(
    [switch]$Force   # 판정을 건너뛰고 무조건 빌드
)

$ErrorActionPreference = 'Continue'
$frontend = Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend'
$distIndex = Join-Path $frontend 'dist\index.html'

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
    if (Test-Path $distIndex) {
        Write-Host '[frontend] node/npm not found - using the build included in this copy.'
    } else {
        Write-Host '[frontend] node/npm not found and no build present - install Node.js or get a copy that includes frontend\dist.'
    }
    exit 0
}

Push-Location $frontend
try {
    if (-not $Force) {
        & $node.Source 'scripts\source-hash.mjs' '--check'
        $state = $LASTEXITCODE
        if ($state -eq 0) { exit 0 }
        # 1 = dist 없음, 2 = 소스 변경 → 아래로 내려가 빌드
    }

    # 의존성: package-lock.json이 node_modules의 설치 마커보다 새로우면(또는 마커가 없으면) npm install.
    $marker = 'node_modules\.package-lock.json'
    $needInstall = -not (Test-Path $marker)
    if (-not $needInstall) {
        $needInstall = (Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item $marker).LastWriteTime
    }
    if ($needInstall) {
        Write-Host '[frontend] dependencies changed - running npm install ...'
        & $npm.Source install
        if ($LASTEXITCODE -ne 0) {
            Write-Host '[frontend] npm install FAILED - see messages above.'
            exit 1
        }
    }

    Write-Host '[frontend] building (npm run build) ...'
    & $npm.Source run build      # postbuild가 dist\.source-hash를 기록한다
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[frontend] build FAILED - see messages above.'
        exit 1
    }
    Write-Host '[frontend] build done.'
    exit 0
} finally {
    Pop-Location
}
