$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force -Path $out | Out-Null
Push-Location $root
try {
  node workbuddy/lib/build-page.mjs
  Push-Location $PSScriptRoot
  try { npm run -s bundle } finally { Pop-Location }
  $config = @{ main = (Join-Path $out 'wb.cjs'); output = (Join-Path $out 'workbuddy-relay.blob'); disableExperimentalSEAWarning = $true } | ConvertTo-Json
  Set-Content -LiteralPath (Join-Path $out 'sea-config.json') -Value $config -Encoding UTF8
  $configPath = Join-Path $out 'sea-config.json'
  node "--experimental-sea-config=$configPath"
  $node = (Get-Command node).Source
  $exe = Join-Path $out 'WorkBuddy-Relay-Import.exe'
  Copy-Item -LiteralPath $node -Destination $exe -Force
  npx --yes postject $exe NODE_SEA_BLOB (Join-Path $out 'workbuddy-relay.blob') --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
  if ($LASTEXITCODE -ne 0) { throw "postject injection failed ($LASTEXITCODE)" }
  Remove-Item -LiteralPath (Join-Path $out 'workbuddy-relay.blob'), $configPath -Force -ErrorAction SilentlyContinue
  Write-Host "Built $exe"
} finally { Pop-Location }
