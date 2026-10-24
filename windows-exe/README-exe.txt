WorkBuddy 中转站一键导入工具  v2.2.1（Windows）
==============================================

作用：把 new-api / sub2api 中转站的地址和 API Key 一键导入 WorkBuddy 的
自定义模型配置（%USERPROFILE%\.workbuddy\models.json），导入后 WorkBuddy 里直接可用。

使用前
  1. 先安装 WorkBuddy：https://www.workbuddy.cn/
  2. 准备好中转站地址（浏览器里打开中转站的那个地址，例如 https://api.example.com）

使用步骤
  1. 双击 WorkBuddy-Relay-Import.exe。会出现一个黑色窗口（导入完成前不要关），
     并自动用默认浏览器打开导入页面；如果没打开，把黑色窗口里的地址复制到浏览器
  2. 在网页里填中转站地址，点「下一步」
  3. 获取 Key：
       - new-api 推荐「用平台令牌自动获取」：个人设置里创建「访问令牌」（nap_ 开头），
         粘贴后点「读取我的 Key」，选一个已有 Key 或新建
       - sub2api 推荐「直接粘贴」已复制好的 sk- Key
  4. 勾选要导入的模型，每个模型可选思考强度（关闭/低/中/高）
  5. 点「导入到 WorkBuddy」，看结果表；不支持思考强度的模型会自动降级并说明
  6. 点「完成，关闭本工具」。WorkBuddy 正在运行时会自动热加载，无需重启。

注意
  - 首次运行 Windows 可能提示「Windows 已保护你的电脑」（SmartScreen，因为程序未签名），
    点「更多信息」→「仍要运行」即可。
  - 平台令牌只在本次运行的内存中使用，不会写入磁盘或日志。
  - 完整图文手册见 Release 页面中的 PDF / HTML
  - 开源项目，源码：https://github.com/xtianowner/workbuddy-relay （MIT）
