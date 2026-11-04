#!/bin/bash
# Offline single-file binaries. Cross-target runtimes are explicit build inputs;
# no runtime download happens while the finished tool starts.
set -eu
cd "$(dirname "$0")"
WB_BUILD_ROOT=$PWD
WB_BUILD_NODE=$(node -p 'process.execPath')
WB_BUILD_PLATFORM=$(node -p 'process.platform')
WB_BUILD_ARCH=$(node -p 'process.arch')
WB_BUILD_VERSION=$(node -p "require('fs').readFileSync('workbuddy/lib/wb-core.mjs','utf8').match(/VERSION = '([^']+)'/)[1]")
mkdir -p dist
cd windows-exe
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run -s bundle
cd "$WB_BUILD_ROOT"
if [ "$WB_BUILD_PLATFORM" = win32 ]; then
  WB_WINDOWS_NODE=${WB_WINDOWS_NODE:-$WB_BUILD_NODE}
elif [ "$WB_BUILD_PLATFORM" = darwin ] && [ "$WB_BUILD_ARCH" = arm64 ]; then
  WB_MACOS_ARM64_NODE=${WB_MACOS_ARM64_NODE:-$WB_BUILD_NODE}
elif [ "$WB_BUILD_PLATFORM" = darwin ] && [ "$WB_BUILD_ARCH" = x64 ]; then
  WB_MACOS_X64_NODE=${WB_MACOS_X64_NODE:-$WB_BUILD_NODE}
fi
WB_BUILT_COUNT=0
WB_BUILT_TARGETS=
build_target() {
  node windows-exe/build-native.mjs --platform "$1" --arch "$2" --runtime "$3" --out "$WB_BUILD_ROOT/dist" --bundle "$WB_BUILD_ROOT/windows-exe/out/wb.cjs" --skip-prepare
  WB_BUILT_COUNT=$((WB_BUILT_COUNT + 1))
  WB_BUILT_TARGETS="$WB_BUILT_TARGETS $1:$2"
}
[ -z "${WB_WINDOWS_NODE:-}" ] || build_target windows x64 "$WB_WINDOWS_NODE"
[ -z "${WB_MACOS_ARM64_NODE:-}" ] || build_target macos arm64 "$WB_MACOS_ARM64_NODE"
[ -z "${WB_MACOS_X64_NODE:-}" ] || build_target macos x64 "$WB_MACOS_X64_NODE"
[ "$WB_BUILT_COUNT" -gt 0 ] || { echo 'Supply a target runtime with WB_WINDOWS_NODE / WB_MACOS_ARM64_NODE / WB_MACOS_X64_NODE.' >&2; exit 1; }
python3 - "$WB_BUILD_ROOT" "$WB_BUILD_VERSION" "$WB_BUILT_TARGETS" <<'PYZIP'
import pathlib, sys, zipfile, json, hashlib
root, version, selected = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3].split()
for platform, arch, suffix, readme in [('windows', 'x64', 'win', 'windows-exe/README-exe.txt'), ('macos', 'arm64', 'mac-arm64', 'mac/README-mac.txt'), ('macos', 'x64', 'mac-x64', 'mac/README-mac.txt')]:
    if f"{platform}:{arch}" not in selected:
        continue
    binary = root / 'dist' / f"WorkBuddy-Relay-Import-{platform}-{arch}{'.exe' if platform == 'windows' else ''}"
    receipt = json.loads(pathlib.Path(str(binary) + ".json").read_text())
    assert receipt["version"] == version
    assert hashlib.sha256(binary.read_bytes()).hexdigest() == receipt["sha256"]
    name = f'workbuddy-relay-{version}-{suffix}'
    with zipfile.ZipFile(root / 'dist' / f'{name}.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for source, target, mode in [(binary, 'WorkBuddy-Relay-Import.exe' if platform == 'windows' else 'WorkBuddy-Relay-Import', 0o755), (root / readme, 'README.txt', 0o644)]:
            info = zipfile.ZipInfo(f'{name}/{target}', (2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, source.read_bytes())
PYZIP
# Manuals are separate artifacts and do not block binary packaging.
if [ "${WB_BUILD_MANUAL:-0}" = 1 ]; then
  bash manual/build-manual.sh
  cp manual/out/* dist/
fi
ls -lh dist
