WorkBuddy 中转站一键导入工具  v2.1.0（Windows）
==============================================

作用：把 new-api / sub2api 中转站的地址和 API Key 一键导入 WorkBuddy 的
自定义模型配置（%USERPROFILE%\.workbuddy\models.json），导入后 WorkBuddy 里直接可用。

使用前
  1. 先安装 WorkBuddy：https://www.workbuddy.cn/
  2. 准备好中转站地址（浏览器里打开中转站的那个地址，例如 https://api.example.com）

使用步骤
  1. 双击 WorkBuddy-Relay-Import.exe
  2. 按提示输入中转站地址
  3. 选择获取 Key 的方式：
       - 平台令牌自动获取：
           new-api：个人设置里创建「访问令牌」（nap_ 开头），粘贴进来
           sub2api：登录后，在浏览器开发者工具 Application → Local Storage
                    里复制 auth_token 的值，粘贴进来
         工具会列出你已有的 Key 供选择，也可以新建一个
       - 或者直接粘贴已经复制好的 sk- Key
  4. 工具会自动测试可用模型并写入配置。WorkBuddy 正在运行时会自动热加载，无需重启。

注意
  - 首次运行 Windows 可能提示「Windows 已保护你的电脑」（SmartScreen，因为程序未签名），
    点「更多信息」→「仍要运行」即可。
  - 平台令牌只在本次运行的内存中使用，不会写入磁盘或日志。
  - 完整图文手册见 Release 页面中的 PDF / HTML
  - 开源项目，源码：https://github.com/xtianowner/workbuddy-relay （MIT）
