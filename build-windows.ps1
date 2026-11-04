$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$version = (Select-String -LiteralPath (Join-Path $root 'workbuddy/lib/wb-core.mjs') -Pattern "VERSION = '([^']+)'" ).Matches.Groups[1].Value
Push-Location (Join-Path $root 'windows-exe')
try {
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)" }
  $node = (Get-Command node).Source
  node build-native.mjs --platform windows --arch x64 --runtime $node --out (Join-Path $root 'dist')
  if ($LASTEXITCODE -ne 0) { throw "native build failed ($LASTEXITCODE)" }
} finally { Pop-Location }
$dist = Join-Path $root 'dist'
$stage = Join-Path $root ('.release-win-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'dist/WorkBuddy-Relay-Import-windows-x64.exe') -Destination (Join-Path $stage 'WorkBuddy-Relay-Import.exe')
Copy-Item -LiteralPath (Join-Path $root 'windows-exe/README-exe.txt') -Destination (Join-Path $stage 'README.txt')
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$zip = Join-Path $dist "workbuddy-relay-$version-win.zip"
if (Test-Path -LiteralPath $zip) { [System.IO.File]::Delete($zip) }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
[System.IO.Directory]::Delete($stage, $true)
Write-Host "Built $zip"
