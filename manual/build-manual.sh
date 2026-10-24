#!/bin/bash
# 生成单文件 HTML（图片内联）+ PDF（Chrome 无头打印）→ manual/out/
set -eu
cd "$(dirname "$0")"
V=$(node -p "require('fs').readFileSync('../workbuddy/lib/wb-core.mjs','utf8').match(/VERSION = '([^']+)'/)[1]")
D=${MANUAL_DATE:-$(date +%Y%m%d)}; N="workbuddy-relay使用手册-v$V-$D"; mkdir -p out
python3 - "$N" <<'PY'
import re, base64, sys
s = open('manual.html', encoding='utf8').read()
s = re.sub(r'src="(img/[^"]+\.png)"', lambda m: 'src="data:image/png;base64,' + base64.b64encode(open(m.group(1), 'rb').read()).decode() + '"', s)
open('out/' + sys.argv[1] + '.html', 'w', encoding='utf8').write(s)
PY
CHROME=${CHROME:-google-chrome}
"$CHROME" --headless --no-sandbox --no-pdf-header-footer --print-to-pdf="$PWD/out/$N.pdf" "file://$PWD/out/$N.html" 2>/dev/null
ls -la out
