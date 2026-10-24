#!/bin/bash
# 双击运行：WorkBuddy 中转站一键导入（纯本地，不联网下载任何代码）
cd "$(dirname "$0")/workbuddy" || exit 1
bash ./setup.sh "$@"
code=$?
echo
read -n 1 -s -r -p "按任意键关闭窗口…"
exit $code
