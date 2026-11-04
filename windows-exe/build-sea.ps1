# Compatibility entry point for existing build commands. The compressed offline
# launcher replaces raw Node SEA while preserving the single-EXE user contract.
$ErrorActionPreference = 'Stop'
& (Join-Path (Split-Path -Parent $PSScriptRoot) 'build-windows.ps1')
if ($LASTEXITCODE -ne 0) { throw "Windows native build failed ($LASTEXITCODE)" }
