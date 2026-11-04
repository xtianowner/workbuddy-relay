<!-- purpose: WorkBuddy 2.5.3 GitHub 发布说明。 -->
- 创建时间：2026-11-04 15:00:00
- 更新时间：2026-11-04 15:00:00
- 时区：Asia/Shanghai

WorkBuddy 快捷配置 2.5.3

- 协议检测和思考能力解析统一复用 llm-protocol-router。WorkBuddy 当前只写入已确认的 Chat Completions 原生配置；未知能力明确显示未知。
- 关闭或卸载配置工具后，WorkBuddy 保留配置并直接连接模型服务。
- Windows EXE 约 37.8 MB，内置压缩运行时，无需安装 Node 或启动后下载运行时。
- Windows x64 与 Apple 芯片 Mac 各提供单文件程序及 ZIP，校验值见 SHA256SUMS.txt。

验证：49 项自动测试和页面交互检查通过，macOS arm64 成品通过版本、帮助、启动器自检。Windows 本版程序尚未真机运行；真实上游与 WorkBuddy 登录后的聊天链路仍待业务实测。
