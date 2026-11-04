<!-- purpose: WorkBuddy 单文件二进制体积优化与构建证据；当前候选未发布 -->
- 创建时间: 2026-11-03 19:54:00
- 更新时间: 2026-11-03 19:54:00
- 时区: Asia/Shanghai

# WorkBuddy 二进制体积优化

旧 Windows Node SEA 文件 `WorkBuddy-Relay-Import-windows-x64.exe` 为 98,979,328 B；PE 主体 `.text` 40,586,240 B、`.rdata` 56,603,136 B，主要成本是未压缩 Node 运行时。对完整旧文件 gzip 仅 36,559,149 B，说明压缩运行时可显著缩小。

本候选新增 Go launcher：Node 运行时和业务 bundle 各自 gzip 后嵌入，启动时写入私有临时目录并以 SHA-256 清单校验，启动 Node 子进程，退出后删除临时目录。成品仍是单个离线二进制，不需要预装 Node，不联网下载代码。

| 候选 | 字节数 | 运行时 | 验证 |
| --- | ---: | ---: | --- |
| Windows x64 | 37,793,280 | 官方 Node v24.12.0 Windows x64，ZIP SHA 与 SHASUMS256 匹配 | PE 静态构建；未在 Windows 真机启动 |
| macOS arm64 | 42,073,088 | 本机 Node v24.12.0 arm64 | `--launcher-self-test`、`--version`、`--help` 均 exit 0；每次临时目录清理 |

本候选仍使用 WorkBuddy 2.5.1 measurement bundle；root 将版本更新为 2.5.2 并完成能力逻辑后重建最终包。不要把这些尺寸或 SHA 当作最终发布物。

构建入口：`build-windows.ps1`、`build-release.sh`、`windows-exe/build-native.mjs`。Windows 最终构建需 Windows x64 的官方 `node.exe` 作为 `--runtime` 输入；Mac x64 需对应 x64 Node。Windows 真机启动、安装器运行与真实 WorkBuddy 导入仍未验证。
