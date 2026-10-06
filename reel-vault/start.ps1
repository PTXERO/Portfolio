# -----------------------------------------------------------------
#  SEARCH//NET - one-step launcher for Windows
#
#  Does everything, then starts the server:
#    1. installs Python (or updates it) - winget, or python.org directly if there's no winget
#    2. installs Git (winget, or Git's portable build) and ffmpeg if they're missing
#    3. downloads the project, or updates it if you already have it
#    4. installs / updates the Python packages (yt-dlp, gallery-dl, fastembed)
#    5. starts the auto-updating launcher (run.py)
#
#  First time, paste this into PowerShell (no download needed):
#    irm https://ptxero.neocities.org/reel-vault/install.txt | iex
#  (same file on GitHub: https://raw.githubusercontent.com/PTXERO/Portfolio/main/reel-vault/start.ps1)
#
#  After that, just double-click  reel-vault\start.cmd  (or run this file again).
#
#  Settings (optional, set before running):
#    $env:REELVAULT_DIR    = 'D:\Portfolio'   # where the project lives (default: ~\Portfolio)
#    $env:REELVAULT_BRANCH = 'main'           # branch to track
#    $env:REELVAULT_NO_SYSTEM_UPDATE = '1'    # skip the Python / Git / ffmpeg update check
#  Anything you pass to this script goes to the server, e.g.  start.ps1 --port 9000
#
#  Kept plain ASCII on purpose: Windows PowerShell 5.1 misreads other characters.
# -----------------------------------------------------------------

& {
  # 'Continue', not 'Stop': in Windows PowerShell 5.1, git and pip write normal
  # progress to stderr, which 'Stop' would turn into a fatal error.
  $ErrorActionPreference = 'Continue'
  $RepoUrl = 'https://github.com/PTXERO/Portfolio'
  $Branch  = if ($env:REELVAULT_BRANCH) { $env:REELVAULT_BRANCH } else { 'main' }
  $DevBranch = 'claude/new-session-7sf9nm'   # where SEARCH//NET lives until it is merged into main
  $ServerArgs = @($args)

  function Say($msg)  { Write-Host "  $msg" -ForegroundColor Cyan }
  function Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
  function Fail($msg) { Write-Host "`n  x $msg`n" -ForegroundColor Red; throw 'SEARCH//NET setup stopped' }
  # run a program and show its output as plain text (stderr included, not as red errors)
  function Run { $exe, $rest = $args; & $exe @rest 2>&1 | ForEach-Object { "$_" } | Out-Host }

  # pick up programs installed a moment ago without reopening the window
  function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
  }
  function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
  $HasWinget = Have 'winget'
  function Winget-Install($id, $what) {      # $true if winget ran, $false if there's no winget
    if (-not $HasWinget) { return $false }
    Say "installing $what..."
    Run winget install -e --id $id --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    return $true
  }
  # downloads (TLS 1.2 for older Windows; no progress bar, which is very slow in PowerShell 5.1)
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
  $ProgressPreference = 'SilentlyContinue'
  $Tools = Join-Path $(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $HOME }) 'SearchNet'
  function Download($url, $dest) {
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  }
  # put a folder on PATH now and for future windows (current user only, no admin)
  function Add-UserPath($dir) {
    $env:Path = "$dir;$env:Path"
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not ("$userPath" -split ';' | Where-Object { $_ -eq $dir })) {
      [Environment]::SetEnvironmentVariable('Path', ("$dir;$userPath").TrimEnd(';'), 'User')
    }
  }
  # no winget: the official python.org installer, silent, just for this user
  function Install-PythonDirect {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
    $url = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-$arch.exe"
    $exe = Join-Path $env:TEMP "python-3.12.10-$arch.exe"
    Say 'downloading Python from python.org...'
    Download $url $exe
    Say 'installing Python (just for you, no admin needed)...'
    Start-Process -FilePath $exe -Wait -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1', 'Include_test=0'
    Refresh-Path
  }
  # no winget: Git's official portable build, unpacked into %LOCALAPPDATA%\SearchNet
  function Install-GitDirect {
    $dir = Join-Path $Tools 'MinGit'
    $zip = Join-Path $env:TEMP 'MinGit.zip'
    Say 'downloading Git (portable) from github.com...'
    Download 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/MinGit-2.47.1-64-bit.zip' $zip
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    Expand-Archive -Path $zip -DestinationPath $dir -Force
    Add-UserPath (Join-Path $dir 'cmd')
  }

  # a real Python (not the Microsoft Store placeholder), or $null
  function Find-Python {
    foreach ($c in @(@('py', '-3'), @('python'), @('python3'))) {
      if (-not (Have $c[0])) { continue }
      $exe = & $c[0] @($c | Select-Object -Skip 1) -c 'import sys; print(sys.executable)' 2>$null
      if ($LASTEXITCODE -eq 0 -and $exe) { return ("$exe" -split "`n" | Select-Object -Last 1).Trim() }
    }
    # just installed but this window's PATH is stale: look where installers put it
    foreach ($d in @("$env:LOCALAPPDATA\Programs\Python", "$env:ProgramFiles\Python312", "$env:ProgramFiles")) {
      $hit = Get-ChildItem -Path $d -Filter python.exe -Recurse -Depth 2 -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -notmatch 'WindowsApps|venv' } | Sort-Object FullName -Descending | Select-Object -First 1
      if ($hit) { return $hit.FullName }
    }
    return $null
  }

  Write-Host "`n  SEARCH//NET setup`n" -ForegroundColor Red

  # -- 1. Python ------------------------------------------------
  $Py = Find-Python
  if (-not $Py) {
    if (Winget-Install 'Python.Python.3.12' 'Python') { $Py = Find-Python }
    if (-not $Py) { Install-PythonDirect; $Py = Find-Python }
    if (-not $Py) { Fail "Python installed, but Windows can't see it yet. Close this window, open a new PowerShell, and run this again. If it still fails: Settings > Apps > Advanced app settings > App execution aliases, turn OFF python.exe and python3.exe." }
  } elseif ($HasWinget -and -not $env:REELVAULT_NO_SYSTEM_UPDATE) {
    Say 'checking for a newer Python...'
    winget upgrade -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements *> $null
  }
  Say ("python: " + ((& $Py --version 2>&1) | ForEach-Object { "$_" }))

  # -- 2. Git and ffmpeg ----------------------------------------
  if (-not (Have 'git')) { $null = Winget-Install 'Git.Git' 'Git' }
  if (-not (Have 'git')) { Install-GitDirect }
  if (-not (Have 'git')) { Fail "Git installed, but this window can't see it yet. Open a new PowerShell and run this again." }
  if (-not (Have 'ffmpeg')) {
    if (-not (Winget-Install 'Gyan.FFmpeg' 'ffmpeg (thumbnails + joining video/audio)')) { Warn 'ffmpeg not found: thumbnails and some downloads will be limited.' }
  }

  # -- 3. the project -------------------------------------------
  # use the copy this script lives in, else REELVAULT_DIR, else ~\Portfolio
  if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot '../.git'))) { $Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
  elseif ($env:REELVAULT_DIR) { $Repo = $env:REELVAULT_DIR }
  else { $Repo = Join-Path $HOME 'Portfolio' }

  if (-not (Test-Path (Join-Path $Repo '.git'))) {
    if ((Test-Path $Repo) -and (Get-ChildItem $Repo -Force | Select-Object -First 1)) { Fail "$Repo exists but isn't a git copy of the project. Move it, or set `$env:REELVAULT_DIR to another folder." }
    Say "downloading the project to $Repo..."
    Run git clone --branch $Branch $RepoUrl $Repo
    if ($LASTEXITCODE -ne 0) { Fail 'Could not download the project (git clone failed).' }
  } else {
    Say "updating the project in $Repo..."
    Run git -C $Repo fetch origin $Branch
    $current = ("" + (git -C $Repo rev-parse --abbrev-ref HEAD 2>$null)).Trim()
    if ($current -ne $Branch) { Run git -C $Repo checkout $Branch }
    Run git -C $Repo pull --ff-only origin $Branch
    if ($LASTEXITCODE -ne 0) { Warn 'Could not fast-forward (local changes?). Starting with what you have.' }
  }

  # if the tracked branch doesn't carry the app yet (not merged), follow the branch that does
  if (-not (Test-Path (Join-Path $Repo 'reel-vault/server/run.py')) -and $Branch -ne $DevBranch) {
    Warn "branch '$Branch' doesn't contain SEARCH//NET yet - using '$DevBranch' instead."
    $Branch = $DevBranch
    Run git -C $Repo fetch origin $Branch
    Run git -C $Repo checkout -B $Branch "origin/$Branch"
    if (-not (Test-Path (Join-Path $Repo 'reel-vault/server/run.py'))) { Fail "Could not find reel-vault/server/run.py on any branch. Check $RepoUrl." }
  }

  # -- 4. Python packages ---------------------------------------
  Say 'installing / updating packages (yt-dlp, gallery-dl, fastembed)...'
  & $Py -m pip install -q --upgrade pip 2>&1 | Out-Null
  Run $Py -m pip install -q --upgrade -r (Join-Path $Repo 'reel-vault/server/requirements.txt') fastembed
  if ($LASTEXITCODE -ne 0) { Warn 'Some packages failed to install; the app will tell you what is missing in SETUP.' }

  # -- 5. start -------------------------------------------------
  Write-Host "`n  Starting SEARCH//NET. Leave this window open; close it to stop.`n" -ForegroundColor Red
  Set-Location $Repo
  & $Py (Join-Path $Repo 'reel-vault/server/run.py') --branch $Branch @ServerArgs
} @args
