# workbuddy-relay

把 [new-api](https://github.com/QuantumNous/new-api) / [sub2api](https://github.com/Wei-Shaw/sub2api) 中转站的地址和 API Key 一键导入 [WorkBuddy](https://www.workbuddy.cn/) 的自定义模型配置（`~/.workbuddy/models.json`）。

纯本地小工具：不需要部署，不需要改动中转站，只调用平台已有的用户侧接口；不需要装 Node（借用 WorkBuddy 自带的 Electron 运行）。

## 功能

- 输入站点地址，自动识别 new-api / sub2api
- 用平台令牌列出你已有的 Key 选择，或新建一个；也可以直接粘贴 `sk-` Key
- 自动探测可用的聊天模型并写入 WorkBuddy，WorkBuddy 运行中会热加载，无需重启
- 自动清理本工具旧版本写入的同站点失效条目
- 平台令牌只在内存里用，不落盘、不写日志

## 下载（推荐普通用户）

到 [Releases](https://github.com/xtianowner/workbuddy-relay/releases/latest) 下载对应的包，解压后双击即可，不需要装 Node：

| 你的电脑 | 下载 |
|---|---|
| Windows (x64) | `workbuddy-relay-<版本>-win.zip` → 双击 `WorkBuddy-Relay-Import.exe` |
| Mac（Apple 芯片 M1/M2/M3/M4） | `workbuddy-relay-<版本>-mac-arm64.zip` → 双击 `WorkBuddy-Relay-Import` |
| Mac（Intel） | `workbuddy-relay-<版本>-mac-x64.zip` → 双击 `WorkBuddy-Relay-Import` |
| 图文使用手册 | `workbuddy-relay-manual-v<版本>-<日期>.pdf` / `.html`（页面显示名为《workbuddy-relay使用手册》） |

前提：本机已安装 WorkBuddy。程序未做商业签名：Windows 若出现 SmartScreen 提示，点「更多信息 → 仍要运行」；Mac 若提示「无法验证开发者」，到「系统设置 → 隐私与安全性」点「仍要打开」。

> ⚠️ macOS 包为 Linux 交叉编译 + ad-hoc 签名，**尚未在真 Mac 上实测**；Windows exe 已在 wine 下运行验证，尚未在真 Windows 上实测。遇到问题请提 [Issue](https://github.com/xtianowner/workbuddy-relay/issues)。

运行后按提示操作：输入站点地址 → 选「用平台令牌自动获取」或「直接粘贴 Key」→ 选 Key → 看到「完成」后，在 WorkBuddy 模型选择器的「自定义 / Custom」分组里使用。

平台令牌：

- **new-api**：个人设置 → 访问令牌 → 新建，勾选 `api_key:read`、`api_key:reveal`、`api_key:write`，复制 `nap_` 开头的令牌
- **sub2api**：推荐直接在「API 密钥」页复制 Key，选「粘贴」

## 从源码运行（开发者 / 不想用二进制）

本仓库就是全部源码（MIT）。克隆或下载源码后双击 `macOS-双击导入.command` / `Windows-双击导入.bat`（借用 WorkBuddy 自带的 Electron 运行，无需装 Node），或 `node workbuddy/wb-setup.mjs --help`。

## 目录

```
workbuddy/            主程序（wb-setup.mjs 入口，lib/ 核心逻辑，setup.sh / setup.ps1 启动脚本）
workbuddy/test/       单元测试与端到端测试（mock 中转站）
windows-exe/          单文件可执行程序的打包配置（Windows / macOS 共用）
mac/                  macOS 包附带的 README
manual/               用户手册源文件、截图、章节目录、缺图清单
build-release.sh      一键构建全部 Release 资产到 dist/
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

### 构建 Release 资产

```bash
bash build-release.sh    # → dist/：win.zip、mac-arm64.zip、mac-x64.zip、使用手册 .html/.pdf
```

esbuild 打包 + [@yao-pkg/pkg](https://github.com/yao-pkg/pkg) 生成单文件程序（内置 Node 运行时，代码以 V8 字节码形式存放）。在 Linux 上交叉编译 macOS arm64 需要 qemu-aarch64 binfmt，并用 [rcodesign](https://github.com/indygreg/apple-platform-rs) 做 ad-hoc 签名；在 Mac 上会改用 `codesign --sign -`。只打手册：`bash manual/build-manual.sh`。

## License

[MIT](LICENSE) © Tian (xtianowner)
