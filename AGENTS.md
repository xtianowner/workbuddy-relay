---
id: agents-workbuddy-relay
type: agents
tags: [workbuddy, new-api, sub2api, local-tool]
scenes: [dev]
related: [brief-shared-001]
summary: "WorkBuddy 中转站一键导入（纯本地 zip 工具）的工程说明"
updated: 2026-10-24
---

# AGENTS.md — workbuddy-relay（工程说明）

## 定位
纯本地工具，不部署、不联网下载自身代码。用户解压 zip 后双击运行，交互式引导：站点地址 → 识别 new-api / sub2api → 平台令牌自动取 Key 或粘贴 Key → 选或建 Key → 写入 `~/.workbuddy/models.json` → 校验热加载。平台侧不需要做任何改造。

## 目录
```
macOS-双击导入.command   → workbuddy/setup.sh
Windows-双击导入.bat     → powershell -ExecutionPolicy Bypass -File workbuddy/setup.ps1
workbuddy/
  setup.sh / setup.ps1   找 WorkBuddy → 选运行时（Node ≥18，否则 WorkBuddy 自带 Electron，ELECTRON_RUN_AS_NODE=1）→ 运行本地 wb-setup.mjs（无 --url 时加 --interactive）
  wb-setup.mjs           交互引导 + 五步流程；也支持参数模式（--url --key / --platform-token --key-id）
  wb-import.mjs          只导入的极简 CLI
  lib/wb-relay.mjs       平台识别、new-api / sub2api 适配
  lib/wb-core.mjs        模型发现、探测、合并写入
  lib/wb-platform.mjs    WorkBuddy 检测与唤起
  test/*.test.mjs        单测（node --test test/*.test.mjs）
  test/e2e/              mock new-api(:18081) / sub2api(:18082) + pty 交互端到端（python3 test/e2e/run-e2e.py）
legacy/index.html        废弃：旧的「网页生成 curl|bash 命令 + 远程托管脚本」模式，不打包
```

## 命令
- 单测：`cd workbuddy && node --test test/*.test.mjs`（不要用 `test/` 目录形式，会把 e2e mock 服务器当测试跑起来挂住）
- 端到端：`cd workbuddy && python3 test/e2e/run-e2e.py`（`SHOW=0` 打印第 0 个用例的完整终端输出）
- 打包：`bash build-zip.sh` → `dist/workbuddy-relay-<VERSION>.zip`

## 约定 / 坑
- 测试开关 `WB_SKIP_DETECT=1`：跳过 WorkBuddy 安装检测（Linux CI 用）。不要写进用户文档。
- `setup.ps1` 必须保持纯 ASCII（PowerShell 5.1 会误解码无 BOM 的 UTF-8）。
- 交互输入共用一个 readline 实例（`ask`），多实例会在非 TTY 下丢输入。
- 平台接口事实与确认项见 DESIGN.md §3、§4。

## 2.3.0 备注

- 思考档位只用 WorkBuddy 对话框选择器能显示的 5 档 low/medium/high/xhigh/max（不含 minimal）。每个模型先发无效值（被接受=中转站忽略参数→保守写低/中/高），否则并发逐档试 5 档 + none；结果写进 supportedEfforts / canDisableThinking。
- 不要信无效值报错里列出的取值：那是全局枚举，不是该模型支持的档位。
- 版本号批量替换时注意 windows-exe/package-lock.json 的误匹配（bare-url 等依赖版本）。

## 2.2.1 备注
- UI 默认中性黑灰（#1F2329），不再保留其它配色。
- 思考强度默认 `auto`：对所选每个模型实测（不按名字猜），通过开「中」，否则关闭；逻辑在 `lib/wb-flow.mjs` + `lib/wb-reasoning.mjs`，测试模型 `acme-mind-7`（未知名但支持思考）在 mock-relays 里。
