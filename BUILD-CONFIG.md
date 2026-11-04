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
构建会自动生成 API 配置和页面模块，再将压缩的 Node 运行时、业务 bundle 和完整性清单嵌入单个 EXE。成品不依赖预装 Node，也不会启动时下载运行时。修改 `.env` 后必须重新构建；运行时不读取旁边的 `.env`。

旧版 raw Node SEA 将运行时以约 94 MiB 原样放进 EXE。本项目现在使用 Go 启动器压缩运行时，运行时在私有临时目录展开、校验、等待子进程退出后删除。构建输入必须是目标平台的官方 Node 可执行文件；Windows 目标需通过 `--runtime` 指定 Windows x64 Node，macOS 目标需指定对应架构 Node。`--launcher-self-test` 只启动并核对运行时及临时目录清理，不执行导入。

```sh
# 以本机 macOS arm64 Node 构建 macOS arm64 候选
node windows-exe/build-native.mjs --platform macos --arch arm64 --runtime "$(command -v node)" --out dist
# Windows x64 需在 Windows 或另备官方 node.exe 后构建
node windows-exe/build-native.mjs --platform windows --arch x64 --runtime /path/to/node.exe --out dist
```

网页只展示 WorkBuddy 快捷配置，不展示 API 地址或平台链接。API 地址仍会写入 WorkBuddy 模型配置，程序运行也需要使用该地址。
