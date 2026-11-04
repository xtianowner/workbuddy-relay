---
id: agents-workbuddy-relay
type: agents
tags: [workbuddy, new-api, sub2api, local-tool]
scenes: [dev]
related: [brief-shared-001]
summary: "WorkBuddy 中转站一键导入（纯本地 zip 工具）的工程说明"
updated: 2026-11-04
---

# AGENTS.md — workbuddy-relay（工程说明）

## 定位
纯本地工具，不部署、不联网下载自身代码。普通网页入口固定使用 SmarAgents `https://www.smaragents.com/v1`，用户只填写 API Key；开发者参数模式仍兼容 `--url` 与平台令牌。用户解压 zip 后双击运行：填写 Key → 选择模型 → 写入 `~/.workbuddy/models.json` → 校验热加载。平台侧不需要做任何改造。

## 2.5.3 候选约定

思考能力只读取当前 Base URL 的 `/models` 声明，使用共享 `llm-protocol-router` reasoning parser `0.4.1-bridge.2`；内嵌二进制用该包 `dist/reasoning.js` 的逐字节快照（SHA256 `a59b4dde2315f112bd777c2b85298c6a944572722afab81dacb3b25081d602d0`）。未声明保持 unknown，不按模型名猜、不生成默认 low/medium/high，不发送无效值或逐档思考请求。基础连通性请求不携带 reasoning 参数。

同步来源、包与 fixture 校验记录在 `workbuddy/lib/vendor/router-provenance.json`。共享协议检测内嵌 `llm-protocol-router/js/dist/protocol-discovery-standalone.mjs` 的逐字节快照（SHA256 `09e5d3867ce569c7517444b862d6c03d086902474f838fc378a9d3606068d6a6`）。

协议字段保留 `auto`、`openai-chat`、`openai-responses`、`anthropic-messages`。WorkBuddy 自定义模型仅确认 Chat 原生配置；自动检测复用共享 router，并限制 `allowedTypes: [chat_completions]`。手动非 Chat 以 `CLIENT_PROTOCOL_UNVERIFIED` 拒绝，零网络、零写入。跳过检测的 auto 仅保留同模型、端点、Key 的既有 Chat 配置，否则 `PROTOCOL_UNVERIFIED`。`useCustomProtocol` 仅控制 URL 透传，不代表存在原生协议适配器。证据见 `docs/1104-workbuddy-native-protocol-evidence.json`。

## 2.4.0 约定

每个 UI 操作、网络状态、模型探测、配置备份/写入/校验和失败阶段写入本地脱敏 JSONL 日志。日志不得包含 Key、令牌、请求/响应正文、聊天内容或配置副本；网页和 CLI 都提供本地 ZIP 导出。Windows 发布包使用 Node SEA 单文件构建：`build-windows.ps1` 或 `windows-exe/build-sea.ps1`。

2.4.1 起网页导入使用后台任务和轮询：`POST /api/import` 立即返回 jobId，`GET /api/import-status?jobId=...` 返回逐模型状态；模型可用性探测最多并发 5 路。基础聊天探测超时 30 秒，以覆盖 SmarAgents 慢响应模型。

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

## 2.3.0 备注（历史实现，已由2.5.2替换）

- 旧版曾逐档探测；2.5.2起不再发送无效值或逐档请求。
- 版本号批量替换时注意 windows-exe/package-lock.json 的误匹配（bare-url 等依赖版本）。

## 2.2.1 备注
- UI 默认中性黑灰（#1F2329），不再保留其它配色。
- 思考强度默认 `auto`：对所选每个模型实测（不按名字猜），通过开「中」，否则关闭；逻辑在 `lib/wb-flow.mjs` + `lib/wb-reasoning.mjs`，测试模型 `acme-mind-7`（未知名但支持思考）在 mock-relays 里。
