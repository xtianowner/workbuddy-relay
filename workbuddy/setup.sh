#!/bin/bash
# ---------------------------------------------------------------
# WorkBuddy 中转站一键接入 · macOS 引导脚本
#
# 纯本地工具：由同目录上一级的「macOS-双击导入.command」调用，
# 所有 .mjs 都在包内，不联网下载任何代码。也可手动：bash setup.sh [--url .. --key ..]
#
# WorkBuddy 自己就是 Electron，可以直接当 Node 22 用，
# 所以本脚本只依赖系统自带工具（open / mdfind）。
# 兼容 macOS 自带的 bash 3.2。
# ---------------------------------------------------------------
set -eu

DOWNLOAD_PAGE="${WB_DOWNLOAD_PAGE:-https://www.workbuddy.cn/}"

URL="${WB_RELAY_URL:-}"
KEY="${WB_RELAY_KEY:-}"
EXTRA=""

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --url=*) URL="${1#*=}"; shift ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --key=*) KEY="${1#*=}"; shift ;;
    *) EXTRA="$EXTRA $1"; shift ;;
  esac
done

say() { printf '  %s\n' "$*"; }
die() { printf '\n  ✗ %s\n\n' "$*" >&2; exit 1; }

printf '\n  WorkBuddy 中转站一键接入\n\n'

# ---------- 1) 找 WorkBuddy ----------
APP=""
for p in "/Applications/WorkBuddy.app" "$HOME/Applications/WorkBuddy.app"; do
  if [ -d "$p" ]; then APP="$p"; break; fi
done
if [ -z "$APP" ]; then
  APP="$(mdfind 'kMDItemCFBundleIdentifier == "com.tencent.workbuddy.mac"' 2>/dev/null | head -1 || true)"
fi
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  say "没有检测到 WorkBuddy，正在打开下载页…"
  open "$DOWNLOAD_PAGE" >/dev/null 2>&1 || true
  die "请先安装 WorkBuddy：$DOWNLOAD_PAGE
     装好后重新运行本命令即可。"
fi
say "WorkBuddy: $APP"

# ---------- 2) 找 JS 运行时 ----------
USE_ELECTRON=0
RUNTIME=""
if command -v node >/dev/null 2>&1; then
  V="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${V:-0}" -ge 18 ] 2>/dev/null; then RUNTIME="$(command -v node)"; fi
fi
if [ -z "$RUNTIME" ]; then
  BIN="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist" 2>/dev/null || echo WorkBuddy)"
  RUNTIME="$APP/Contents/MacOS/$BIN"
  if [ ! -x "$RUNTIME" ]; then RUNTIME="$APP/Contents/MacOS/Electron"; fi
  if [ ! -x "$RUNTIME" ]; then die "找不到 WorkBuddy 的可执行文件，安装可能不完整"; fi
  USE_ELECTRON=1
  say "运行时: WorkBuddy 内置 Electron（无需安装 Node）"
else
  say "运行时: $RUNTIME"
fi

# ---------- 3) 准备脚本 ----------
HERE=""
if [ -n "${BASH_SOURCE:-}" ]; then
  HERE="$(cd "$(dirname "$BASH_SOURCE")" 2>/dev/null && pwd || echo "")"
fi
# 支持两种目录布局：脚本与 wb-setup.mjs 同级，或脚本在 bootstrap/ 子目录
WORKDIR=""
for cand in "$HERE" "$HERE/.."; do
  if [ -n "$cand" ] && [ -f "$cand/wb-setup.mjs" ] && [ -f "$cand/lib/wb-core.mjs" ]; then
    WORKDIR="$(cd "$cand" && pwd)"
    break
  fi
done
[ -n "$WORKDIR" ] || die "包不完整：找不到 wb-setup.mjs / lib/，请重新解压整个 zip"
[ -f "$WORKDIR/lib/wb-relay.mjs" ] || die "包不完整：缺少 lib/wb-relay.mjs"

# ---------- 4) 执行 ----------
if [ -n "$URL" ]; then
  set -- --url "$URL"
else
  set -- --web
fi
if [ -n "$KEY" ]; then
  set -- "$@" --key "$KEY"
fi
if [ -n "$EXTRA" ]; then
  # shellcheck disable=SC2086
  set -- "$@" $EXTRA
fi

if [ "$USE_ELECTRON" = "1" ]; then
  ELECTRON_RUN_AS_NODE=1 "$RUNTIME" "$WORKDIR/wb-setup.mjs" "$@"
else
  "$RUNTIME" "$WORKDIR/wb-setup.mjs" "$@"
fi
