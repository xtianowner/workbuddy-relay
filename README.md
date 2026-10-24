# workbuddy-relay

把 [new-api](https://github.com/QuantumNous/new-api) / [sub2api](https://github.com/Wei-Shaw/sub2api) 中转站的地址和 API Key 一键导入 [WorkBuddy](https://www.workbuddy.cn/) 的自定义模型配置（`~/.workbuddy/models.json`）。

纯本地小工具：不需要部署，不需要改动中转站，只调用平台已有的用户侧接口；不需要装 Node（借用 WorkBuddy 自带的 Electron 运行）。

## 功能

- 输入站点地址，自动识别 new-api / sub2api
- 用平台令牌列出你已有的 Key 选择，或新建一个；也可以直接粘贴 `sk-` Key
- 自动探测可用的聊天模型并写入 WorkBuddy，WorkBuddy 运行中会热加载，无需重启
- 自动清理本工具旧版本写入的同站点失效条目
- 平台令牌只在内存里用，不落盘、不写日志

## 使用

前提：本机已安装 WorkBuddy（macOS 或 Windows）。

1. 下载本仓库（或 Release 里的 zip）并解压
2. 双击：
   - macOS：`macOS-双击导入.command`（被拦截时右键 → 打开）
   - Windows：`Windows-双击导入.bat`
3. 按提示输入站点地址、选择获取 Key 的方式，看到「完成」后到 WorkBuddy 模型选择器的「自定义 / Custom」分组里即可使用

平台令牌：

- **new-api**：个人设置 → 访问令牌 → 新建，勾选 `api_key:read`、`api_key:reveal`、`api_key:write`，复制 `nap_` 开头的令牌
- **sub2api**：推荐直接在「API 密钥」页复制 Key，选「粘贴」

命令行用法：`node workbuddy/wb-setup.mjs --help`

## 目录

```
workbuddy/            主程序（wb-setup.mjs 入口，lib/ 核心逻辑，setup.sh / setup.ps1 启动脚本）
workbuddy/test/       单元测试与端到端测试（mock 中转站）
windows-exe/          可选：打包成单个 Windows exe
legacy/               已废弃的网页版，仅供参考
DESIGN.md             设计说明与平台接口事实
AGENTS.md             给 AI 编程助手看的开发约定
build-zip.sh          打用户发行 zip（输出到 dist/）
```

## 开发

```bash
cd workbuddy
node --test test/*.test.mjs          # 单元测试（不要写成 test/，会把 e2e mock 服务器挂起）
python3 test/e2e/run-e2e.py          # 端到端交互测试（需要 python3，Linux/macOS）
```

打用户 zip：`bash build-zip.sh` → `dist/workbuddy-relay-<版本>.zip`

### 可选：Windows 单文件 exe

```bash
cd windows-exe && npm install && npm run build   # → out/WorkBuddy-Relay-Import.exe
```

用 esbuild 打包 + [@yao-pkg/pkg](https://github.com/yao-pkg/pkg) 生成，exe 内置 Node 运行时。exe 未签名，首次运行可能出现 SmartScreen 提示。随 exe 分发的说明见 `windows-exe/README-exe.txt`。

## License

[MIT](LICENSE) © Tian (xtianowner)
