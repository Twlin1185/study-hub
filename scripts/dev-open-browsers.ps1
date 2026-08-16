<#
    dev-open-browsers.ps1 -- open the two Study Hub dev surfaces in SEPARATE browser windows.

    Called by Dev_StartServer.bat once the server answers on the given port.
        window 1 = existing app   http://localhost:<port>/
        window 2 = notes beta     http://localhost:<port>/notes

    Why separate windows instead of two tabs: on the dev PC the two surfaces are
    easy to mix up. Separate windows are told apart in the taskbar; two tabs of the
    same site are not. Chromium- and Firefox-based browsers get an explicit
    new-window flag; anything else falls back to the default handler (usually a
    tab -- still better than opening only one of the two).

    The tab captions also differ: the notes screens set their own document.title
    while the rest of the app keeps the default "Study Hub".
    See frontend/src/editor2/lib/useNoteDocumentTitle.ts.

    ASCII only + CRLF -- same rule the .bat files follow.
#>
param(
    [int]$Port = 8000,
    [int]$TimeoutSeconds = 60
)

function Wait-ForServer {
    param([int]$Port, [int]$TimeoutSeconds)
    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        try {
            $client = New-Object Net.Sockets.TcpClient('localhost', $Port)
            $client.Close()
            return $true
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

# Default browser executable, read from the user's URL association.
# Returns $null when it cannot be resolved -- callers fall back to Start-Process <url>.
function Get-DefaultBrowserPath {
    try {
        $userChoice = 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice'
        $progId = (Get-ItemProperty $userChoice -ErrorAction Stop).ProgId
        if (-not $progId) { return $null }
        $key = 'Registry::HKEY_CLASSES_ROOT\' + $progId + '\shell\open\command'
        $command = (Get-ItemProperty $key -ErrorAction Stop).'(default)'
        if (-not $command) { return $null }
        # Typical value: "C:\Program Files\...\chrome.exe" -- "%1"
        if ($command -match '^\s*"([^"]+)"') { return $matches[1] }
        if ($command -match '^\s*(\S+\.exe)') { return $matches[1] }
        return $null
    } catch {
        return $null
    }
}

function Get-NewWindowFlag {
    param([string]$ExePath)
    if (-not $ExePath) { return $null }
    $name = [IO.Path]::GetFileNameWithoutExtension($ExePath).ToLower()
    if (@('chrome', 'msedge', 'brave', 'vivaldi', 'opera', 'chromium') -contains $name) { return '--new-window' }
    if ($name -eq 'firefox') { return '-new-window' }
    return $null
}

if (-not (Wait-ForServer -Port $Port -TimeoutSeconds $TimeoutSeconds)) {
    Write-Host "[WARN] no answer on port $Port within $TimeoutSeconds s - skipping browser launch."
    exit 0
}

$exe = Get-DefaultBrowserPath
$flag = Get-NewWindowFlag -ExePath $exe
$canOpenWindow = ($flag -ne $null) -and ($exe -ne $null) -and (Test-Path $exe)

$targets = @("http://localhost:$Port/", "http://localhost:$Port/notes")

foreach ($url in $targets) {
    if ($canOpenWindow) {
        Start-Process -FilePath $exe -ArgumentList $flag, $url
    } else {
        Start-Process $url
    }
    # Let the first window settle before asking for the second one; without this
    # some browsers merge both requests into a single window.
    Start-Sleep -Milliseconds 900
}
