WorkBuddy 快捷配置 v2.5.1（macOS Apple 芯片）

先安装 WorkBuddy：https://www.workbuddy.cn/
双击 WorkBuddy-Relay-Import，在本地网页填写 API Key → 选择模型和思考强度 → 导入。
完成后点击「完成，关闭本工具」。错误排查可点击「一键导出历史日志」。
程序内置 Node 运行时，无需另外安装；使用 ad-hoc 签名。
若系统阻止首次打开，在「系统设置 → 隐私与安全性」允许打开。

网页连接构建时预设的 API 服务。API Key 会写入 WorkBuddy models.json；日志不记录 Key、正文或配置副本。
本版已在 Apple M1 / macOS 15.5 验证启动、模拟接口导入、备份、重复更新、日志与网页鉴权。
真实模型调用与登录后 WorkBuddy 聊天另需有效 API Key 和客户端账号；本次未覆盖。
源码与验证范围：https://github.com/xtianowner/workbuddy-relay
MIT License
