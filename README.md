<!-- purpose: WorkBuddy 本地模型导入工具的下载、运行、构建与验证说明。 -->
- 创建时间：2026-10-24 00:00:00
- 更新时间：2026-11-03 10:44:46
- 时区：Asia/Shanghai

# WorkBuddy 快捷配置 · v2.5.1

在本地网页填写 API Key、选择模型和思考强度，将配置写入 WorkBuddy。网页使用构建时预设的 API 服务地址；开发者可在构建前修改 `.env` 中的 `WB_API_BASE_URL`，缺少 `.env` 时使用 `.env.example`。

## 下载与运行

从 [Releases](https://github.com/xtianowner/workbuddy-relay/releases/latest) 下载：

| 系统 | 文件与入口 |
|---|---|
| Windows x64 | `WorkBuddy-Relay-Import-windows-x64.exe`，直接运行 |
| Apple 芯片 Mac | `WorkBuddy-Relay-Import-mac-arm64`，单个可执行文件 |

每个平台只下载一个文件即可。GitHub 自动生成的 `Source code` 入口供开发者使用。Mac 浏览器下载可能不保留执行权限，需在下载目录执行 `chmod +x WorkBuddy-Relay-Import-mac-arm64` 后打开。

先安装 [WorkBuddy](https://www.workbuddy.cn/)。独立程序内置运行时，无需安装 Node；源码入口可借用 WorkBuddy 自带的 Electron。Mac 程序使用 ad-hoc 签名，首次运行可能需要在「系统设置 → 隐私与安全性」允许打开。

填写 Key → 读取模型 → 勾选模型与思考强度 → 导入 → 完成后关闭工具。工具只监听本机回环地址，浏览器/API 使用随机会话口令。导入时最多并发检测 **5 个模型**，逐行显示进度；服务限流、超时或临时错误不会直接判定模型不支持思考。请求接受了思考参数不等于已确认不同档位的实际效果。

同站点模型可更新，同名跨站点模型保留原配置并提示跳过。写入前创建备份，写入后回读校验；API Key 会保存在 WorkBuddy 的 `models.json`，该文件权限设为 600。

## 日志

页面底部可导出本机脱敏日志 ZIP。日志记录操作、耗时、HTTP 状态、模型名和错误码，不记录 API Key、平台令牌、请求/响应正文、聊天内容或配置副本，导出不会自动上传。

- Windows：`%LOCALAPPDATA%\SmarAgents\WorkBuddyRelay\logs`
- macOS：`~/Library/Logs/SmarAgents/WorkBuddyRelay/logs`
- Linux：`~/.local/state/SmarAgents/WorkBuddyRelay/logs`

默认保留 30 天、最多 100 个文件或 40 MB。CLI 可用 `--export-logs <zip路径>` 导出。

## 开发与构建

需要 Node 20+、npm，Mac 二进制签名使用系统 `codesign`。配置说明见 [BUILD-CONFIG.md](BUILD-CONFIG.md)。

```bash
node configure-build.mjs
node workbuddy/lib/build-page.mjs
node --test workbuddy/test/*.test.mjs
node workbuddy/wb-setup.mjs
```

源码发行包：`bash build-zip.sh`。Mac arm64 成品：

```bash
cd windows-exe
npm ci
npm run bundle
npx pkg out/wb.cjs -t node20-macos-arm64 -C GZip -o out/WorkBuddy-Relay-Import
codesign --force --sign - out/WorkBuddy-Relay-Import
out/WorkBuddy-Relay-Import --version
```

Windows SEA 构建：`powershell -ExecutionPolicy Bypass -File build-windows.ps1`。API Key 在运行时输入，不写进构建配置。开发者 CLI 保留 `--url`、`--platform-token`、`--key-id`，完整参数见 `--help`。

## 本版验证范围

2026-11-03 在 Apple M1 / macOS 15.5 上验证了 36 项自动测试；独立 arm64 成品通过版本、签名、模拟 API 导入、重复更新、配置备份、600 权限、日志 ZIP 脱敏和网页鉴权检查。源码测试使用官方 WorkBuddy 5.9.3 自带的 Node 22.21.1；独立成品无需 Node。Linux arm64 兼容性门禁通过。

真实付费模型调用、WorkBuddy 登录后模型选择与聊天、Intel Mac 本版成品尚未验证。Windows EXE 使用随 2.5.1 更新包提供的原件，本轮未重新测试 Windows；源码与 Mac 额外修复了进度恢复失败后的界面锁定和退出失败提示，Windows 原件尚未包含这两项页面修正。

当前会话的浏览器自动化入口不可用，未完成本版页面真渲染与窄屏验收。

`workbuddy/test/e2e/` 中的旧交互脚本面向 2.3.0 的站点选择流程；2.5.1 当前回归入口为上面的 `node --test workbuddy/test/*.test.mjs`，其中 `web.test.mjs` 覆盖异步导入 API、进度、跨站保留、备份和脱敏日志。

## License

[MIT](LICENSE) © Tian (xtianowner)
