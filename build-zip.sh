#!/bin/bash
# 打包纯本地发行 zip（不含 legacy/、test/、设计文档）
set -eu
cd "$(dirname "$0")"
V=$(node -p "require('fs').readFileSync('workbuddy/lib/wb-core.mjs','utf8').match(/VERSION = '([^']+)'/)[1]")
OUT="$PWD/dist"; NAME="workbuddy-relay-$V"; STAGE=$(mktemp -d)
mkdir -p "$STAGE/$NAME/workbuddy/lib" "$OUT"
cp README.md "macOS-双击导入.command" "Windows-双击导入.bat" "$STAGE/$NAME/"
cp workbuddy/setup.sh workbuddy/setup.ps1 workbuddy/wb-setup.mjs workbuddy/wb-import.mjs "$STAGE/$NAME/workbuddy/"
cp workbuddy/lib/*.mjs "$STAGE/$NAME/workbuddy/lib/"
chmod +x "$STAGE/$NAME/macOS-双击导入.command" "$STAGE/$NAME/workbuddy/setup.sh"
rm -f "$OUT/$NAME.zip"
# 用 python zipfile：保留 unix 可执行位，文件名按 UTF-8 标记（macOS / Windows 解压中文名正常）
python3 - "$STAGE" "$NAME" "$OUT/$NAME.zip" <<'PY'
import os, sys, zipfile
stage, name, out = sys.argv[1:]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(os.path.join(stage, name)):
        dirs.sort()
        for f in sorted(files):
            full = os.path.join(root, f); arc = os.path.relpath(full, stage)
            zi = zipfile.ZipInfo(arc, (2026, 10, 24, 0, 0, 0)); zi.create_system = 3
            zi.external_attr = (os.stat(full).st_mode & 0xFFFF) << 16; zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, open(full, 'rb').read())
PY
rm -rf "$STAGE"; echo "$OUT/$NAME.zip"
