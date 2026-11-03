# 打包配置

<!-- purpose: 配置构建时预设的 API 地址。 -->
- 创建时间：2026-11-02 18:35:00
- 更新时间：2026-11-03 10:15:00
- 时区：Asia/Shanghai

修改项目根目录 `.env`（可从 `.env.example` 复制；未创建时自动使用示例默认值）：

```dotenv
WB_API_BASE_URL=https://124.223.174.61:3443/
```

根地址会自动追加 `/v1`。也可以填写完整 API base，例如 `https://example.com/custom/v1`，该路径会原样保留。不要填写 API Key；密钥由用户运行程序时输入。

Windows 构建：`powershell -ExecutionPolicy Bypass -File build-windows.ps1`。
构建会自动生成 API 配置和页面模块，再嵌入 EXE。修改 `.env` 后必须重新构建；运行时不读取旁边的 `.env`。

网页只展示 WorkBuddy 快捷配置，不展示 API 地址或平台链接。API 地址仍会写入 WorkBuddy 模型配置，程序运行也需要使用该地址。
