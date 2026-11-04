<!-- purpose: WorkBuddy 2.5.2 与 Bridge 共享思考能力声明改造的交付验收索引 -->
- 创建时间: 2026-11-03 20:45:00
- 更新时间: 2026-11-03 20:45:00
- 时区: Asia/Shanghai

# 交付验收索引

本轮四项子任务交付均归入同一跨项目任务：WorkBuddy 2.5.2 与 smar-codex-bridge 0.8.15 候选统一读取当前 Base URL 的 `/models` 能力声明；缺失声明保持 unknown，不发送无效 effort 或逐档思考请求。

## 已通过门禁

- WorkBuddy Node 测试：38/38；CLI mock E2E：4/4；共享 parser 9 个向量通过。
- WorkBuddy UI 合成验收：390px、1440px，无横向溢出；声明档位、mandatory、未声明三类状态可区分。
- WorkBuddy 2.5.2 macOS arm64 二进制：`--launcher-self-test`、`--version`、`--help` 通过；内嵌 Node v24.12.0，临时目录清理。
- Windows 单文件优化：旧约 98,979,328 B；压缩 launcher 候选约 37,793,280 B，下降约 61.8%；Windows 仅完成本机 PE 构建与静态架构核验。
- Bridge：全套 613 通过、0 失败、19 跳过；UI 16/16；ESLint 退出 0。

## 未覆盖

WorkBuddy Windows 二进制未在 Windows 真机启动；两个项目未提交、未推送、未发布。未发送真实模型请求，未写真实用户配置；真实第三方上游的具体 effort 支持仍取决于其 `/models` 声明质量。Bridge 0.8.15 候选的 Windows 原生卸载链路仍未实机运行。

## 证据入口

- WorkBuddy：[workbuddy-tests.txt](workbuddy-tests.txt)、[workbuddy-e2e.txt](workbuddy-e2e.txt)、[UI results](ui/results.json)、[packaging README](packaging/README.md)。
- Bridge：[effort research](../../sub2/智界中转/02-系统开发与部署/smar-codex-bridge/docs/1103-effort-research/report.md)、[standalone acceptance](../../sub2/智界中转/02-系统开发与部署/smar-codex-bridge/docs/1103-standalone-config/acceptance.md)。
