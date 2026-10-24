# ------------------------------------------------------------------
# WorkBuddy relay one-click setup - Windows bootstrap
#
# Local tool: launched by "Windows-double-click-import.bat" in the unzipped
# package. All .mjs files ship in the package; nothing is downloaded.
# Or run directly:
#   .\setup.ps1 -Url https://relay.example.com -Key sk-xxx
#
# WorkBuddy is an Electron app, so WorkBuddy.exe itself can act as a
# Node 22 runtime via ELECTRON_RUN_AS_NODE=1. No extra runtime needed.
# NOTE: keep this file ASCII-only; Windows PowerShell 5.1 mis-decodes
#       UTF-8 .ps1 files without BOM.
# ------------------------------------------------------------------
param(
  [string]$Url = $env:WB_RELAY_URL,
  [string]$Key = $env:WB_RELAY_KEY,
  [string]$DownloadPage = $env:WB_DOWNLOAD_PAGE,
  [string]$Extra = '',
  [switch]$Json
)

if (-not $DownloadPage) { $DownloadPage = 'https://www.workbuddy.cn/' }

$ErrorActionPreference = 'Stop'

# When executed via `irm ... | iex` there is no $PSScriptRoot. In that mode
# we must never call exit, otherwise the user's own PowerShell window closes.
$script:Piped = -not $PSScriptRoot

function Say($m) { Write-Host "  $m" }
function Die($m) {
  Write-Host ""
  Write-Host "  x $m" -ForegroundColor Red
  Write-Host ""
  if ($script:Piped) { throw $m } else { exit 1 }
}

Write-Host ""
Write-Host "  WorkBuddy relay one-click setup"
Write-Host ""

# ---------- 1) locate WorkBuddy ----------
$candidates = @()
$local = $env:LOCALAPPDATA
if ($local) {
  $candidates += (Join-Path $local 'Programs\WorkBuddy\WorkBuddy.exe')
  $candidates += (Join-Path $local 'Programs\workbuddy\WorkBuddy.exe')
  $candidates += (Join-Path $local 'WorkBuddy\WorkBuddy.exe')
}
if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'WorkBuddy\WorkBuddy.exe') }
if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'WorkBuddy\WorkBuddy.exe') }

foreach ($hive in @('HKLM:', 'HKCU:')) {
  $key = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\WorkBuddy.exe"
  try {
    $item = Get-ItemProperty -Path $key -ErrorAction Stop
    if ($item.'(default)') { $candidates = @($item.'(default)') + $candidates }
  } catch { }
}

$exe = $null
foreach ($c in $candidates) {
  if ($c -and (Test-Path -LiteralPath $c)) { $exe = (Resolve-Path -LiteralPath $c).Path; break }
}
if (-not $exe) {
  $cmd = Get-Command WorkBuddy.exe -ErrorAction SilentlyContinue
  if ($cmd) { $exe = $cmd.Source }
}
if (-not $exe) {
  Say "WorkBuddy not found. Opening download page..."
  Start-Process $DownloadPage
  Die "Install WorkBuddy first: $DownloadPage"
}
$ver = ''
try { $ver = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion } catch { }
$verText = ''
if ($ver) { $verText = ' v' + $ver }
Say ('WorkBuddy: ' + $exe + $verText + '  (already running is fine)')

# ---------- 2) pick a JS runtime ----------
$runtime = $null
$useElectron = $false
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $major = 0
  try { $major = [int](& $node.Source -p "process.versions.node.split('.')[0]") } catch { $major = 0 }
  if ($major -ge 18) { $runtime = $node.Source }
}
if (-not $runtime) {
  $runtime = $exe
  $useElectron = $true
  Say "Runtime: built-in Electron of WorkBuddy (no Node.js needed)"
} else {
  Say "Runtime: $runtime"
}

# ---------- 3) prepare scripts ----------
$here = $PSScriptRoot
if (-not $here) { $here = (Get-Location).Path }
$setup = Join-Path $here 'wb-setup.mjs'
$core = Join-Path $here 'lib\wb-core.mjs'
$cleanup = $false

if (-not (Test-Path -LiteralPath $setup) -or -not (Test-Path -LiteralPath $core) -or -not (Test-Path -LiteralPath (Join-Path $here 'lib\wb-relay.mjs'))) {
  Die "Package incomplete: wb-setup.mjs / lib\*.mjs not found next to setup.ps1. Please unzip the whole package again."
}
Say "Scripts: local $here"

# ---------- 4) run ----------
$argv = @($setup)
if ($Url) { $argv += @('--url', $Url) } else { $argv += '--interactive' }
if ($Key) { $argv += @('--key', $Key) }
if ($Extra) { $argv += ($Extra -split '\s+') }
if ($Json) { $argv += '--json' }

$code = 0
$argLine = ($argv | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
try {
  if ($useElectron) { $env:ELECTRON_RUN_AS_NODE = '1' }
  # WorkBuddy.exe is a GUI-subsystem binary: calling it with & returns at once
  # and swallows stdout. Start-Process -NoNewWindow -Wait attaches it to this
  # console and waits for completion.
  $p = Start-Process -FilePath $runtime -ArgumentList $argLine -NoNewWindow -Wait -PassThru
  if ($p) { $code = $p.ExitCode }
} finally {
  if ($useElectron) { Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
}
if (-not $script:Piped) { exit $code }
