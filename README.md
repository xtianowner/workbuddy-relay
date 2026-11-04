<!-- purpose: WorkBuddy 本地模型导入工具的下载、运行、构建与验证说明。 -->
- 创建时间：2026-10-24 00:00:00
- 更新时间：2026-11-04 13:19:27
- 时区：Asia/Shanghai

# WorkBuddy 快捷配置 · v2.5.3

在本地网页填写 API Key、选择模型和思考强度，将配置写入 WorkBuddy。网页使用构建时预设的 API 服务地址；开发者可在构建前修改 `.env` 中的 `WB_API_BASE_URL`，缺少 `.env` 时使用 `.env.example`。

本版安装包通过 GitHub Releases 分发。协议自动检测仅验证 WorkBuddy 已确认支持的 Chat Completions；手动选择 Responses 或 Anthropic 会提示尚未验证并停止导入。思考强度只读取上游 `/models` 的明确声明，缺少声明显示未知，不猜测档位。配置直接连接上游，关闭或卸载配置工具后仍可使用。

## 下载与运行

从 [Releases](https://github.com/xtianowner/workbuddy-relay/releases/latest) 下载：

| 系统 | 文件与入口 |
|---|---|
| Windows x64 | `WorkBuddy-Relay-Import-windows-x64.exe`，直接运行 |
| Apple 芯片 Mac | `WorkBuddy-Relay-Import-macos-arm64`，单个可执行文件 |

每个平台只下载一个文件即可。GitHub 自动生成的 `Source code` 入口供开发者使用。Mac 浏览器下载可能不保留执行权限，需在下载目录执行 `chmod +x WorkBuddy-Relay-Import-macos-arm64` 后打开。

先安装 [WorkBuddy](https://www.workbuddy.cn/)。独立程序内置运行时，无需安装 Node；源码入口可借用 WorkBuddy 自带的 Electron。Mac 程序使用 ad-hoc 签名，首次运行可能需要在「系统设置 → 隐私与安全性」允许打开。

填写 Key → 读取模型 → 勾选模型与思考强度 → 导入 → 完成后关闭工具。工具只监听本机回环地址，浏览器/API 使用随机会话口令。导入时最多并发检测 **5 个模型**，逐行显示进度；服务限流、超时或临时错误不会直接判定模型不支持思考。基础连通性检测不携带思考参数，也不逐档发请求探测思考能力。

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

源码发行包：`bash build-zip.sh`。当前独立二进制使用压缩运行时启动器，构建命令见 [BUILD-CONFIG.md](BUILD-CONFIG.md)。Windows 与 macOS 均内置目标平台 Node，运行时不另行下载。API Key 在用户运行时输入，不写进构建配置。开发者 CLI 参数见 `--help`。

## 本版验证范围

本版通过 49 项自动测试、390/1440 宽度页面交互检查，以及 macOS arm64 独立二进制的版本、帮助和运行时自检。Windows x64 EXE 已重新构建，约 37.8 MB；平台文件大小与 SHA256 见 [构建记录](docs/1104-auto-protocol/artifacts.json)。

Windows 本版二进制尚未真机运行；真实上游模型调用、WorkBuddy 登录后模型选择与聊天、Intel Mac 尚未验证。协议识别与能力解析的测试不替代这些实机验收。

## License

[MIT](LICENSE) © Tian (xtianowner)
