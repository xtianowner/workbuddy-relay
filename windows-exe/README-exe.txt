WorkBuddy 快捷配置  v2.5.1（Windows）
================================================

这是免安装单文件版本。普通用户不需要 Node，也不需要填写中转站地址。

使用
  1. 安装 WorkBuddy：https://www.workbuddy.cn/
  2. 双击 WorkBuddy-Relay-Import.exe。
  3. 在浏览器本地页面填写 API Key（服务地址已预设），选择模型并导入。
  4. 失败时点击「一键导出历史日志」，把下载的 ZIP 发给客服。

日志
  保存到 %LOCALAPPDATA%\SmarAgents\WorkBuddyRelay\logs
  默认保留 30 天，最多 100 个文件或 40 MB。
  日志经过脱敏，不包含 API Key、平台令牌、请求/响应正文、聊天内容或 models.json 副本。
  导出的压缩包只保存在本地，不会自动上传。

注意
  - 未签名程序可能显示 Windows SmartScreen，选择「更多信息」→「仍要运行」。
  - WorkBuddy 必须已安装；导入成功后运行中的 WorkBuddy 会热加载配置。
  - 开源项目（MIT）：https://github.com/xtianowner/workbuddy-relay

开发者
  cd windows-exe
  npm ci
  npm run build:sea

本包 EXE 沿用收到的 2.5.1 原件；本轮只测试 Mac。源码/Mac 额外修复进度恢复与退出失败提示，Windows 原件尚未包含这两项页面修正。
