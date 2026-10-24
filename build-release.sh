#!/bin/bash
# 构建 Release 资产 → dist/：Windows exe zip、macOS arm64/x64 zip、手册 HTML/PDF
# 依赖：node、npm、python3、google-chrome；macOS arm64 字节码需 qemu-aarch64 binfmt（Linux 交叉编译时），
#      macOS 签名需 rcodesign（ad-hoc），在 Mac 上可改用 codesign --sign -
set -eu
cd "$(dirname "$0")"; ROOT=$PWD
V=$(node -p "require('fs').readFileSync('workbuddy/lib/wb-core.mjs','utf8').match(/VERSION = '([^']+)'/)[1]")
mkdir -p dist; cd windows-exe; [ -d node_modules ] || npm install
npm run -s bundle
npx pkg out/wb.cjs -t node20-win-x64,node20-macos-arm64,node20-macos-x64 -C GZip --out-path out/bin
for a in arm64 x64; do
  if command -v rcodesign >/dev/null; then rcodesign sign out/bin/wb-macos-$a >/dev/null
  elif command -v codesign >/dev/null; then codesign --force --sign - out/bin/wb-macos-$a; fi
done
python3 - "$ROOT" "$V" <<'PY'
import zipfile, sys, os
root, v = sys.argv[1:]; b = root + '/windows-exe/out/bin/'
def mk(name, files):
    with zipfile.ZipFile(f'{root}/dist/{name}.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        for src, arc, mode in files:
            zi = zipfile.ZipInfo(f'{name}/{arc}', (2026, 1, 1, 0, 0, 0)); zi.create_system = 3
            zi.external_attr = (0o100000 | mode) << 16; zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, open(src, 'rb').read())
mk(f'workbuddy-relay-{v}-win', [(b + 'wb-win-x64.exe', 'WorkBuddy-Relay-Import.exe', 0o755), (root + '/windows-exe/README-exe.txt', 'README.txt', 0o644)])
for a in ('arm64', 'x64'):
    mk(f'workbuddy-relay-{v}-mac-{a}', [(b + f'wb-macos-{a}', 'WorkBuddy-Relay-Import', 0o755), (root + '/mac/README-mac.txt', 'README.txt', 0o644)])
PY
cd "$ROOT"; bash manual/build-manual.sh >/dev/null; cp manual/out/* dist/
ls -la dist
