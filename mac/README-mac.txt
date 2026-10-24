WorkBuddy 中转站一键导入工具  v2.1.0（macOS）
==============================================

作用：把 new-api / sub2api 中转站的 Key 一键导入 WorkBuddy 的自定义模型。

使用
  1. 先安装 WorkBuddy：https://www.workbuddy.cn/
  2. 双击 WorkBuddy-Relay-Import，会打开「终端」窗口，按提示操作
  3. 完成后，在 WorkBuddy 模型选择器的「自定义 / Custom」分组里就能看到新模型

第一次打开提示「无法验证开发者」时：
  系统设置 → 隐私与安全性 → 往下找到「已阻止使用 WorkBuddy-Relay-Import」→ 点「仍要打开」
  （或：在终端里执行 xattr -d com.apple.quarantine 后面拖入本程序，回车）

说明
  - 平台令牌只在本次运行的内存中使用，不写入磁盘
  - 开源项目，源码：https://github.com/xtianowner/workbuddy-relay （MIT）
  - 完整图文手册见 Release 页面中的 PDF / HTML
