# WorkBuddy 中转站一键接入 · 设计方案 v2

> v2 · 2026-10-24 · **原则：不改 new-api / sub2api 任何代码，只用它们现有的用户侧接口。**
> 两个平台本来就让用户在网页上复制「API 端点 + Key」（new-api 令牌管理页、sub2api API 密钥页）。v2 只是把「复制 → 粘贴 → 配置 WorkBuddy」简化成一步。
> 代码：`workbuddy/lib/wb-relay.mjs`、`wb-setup.mjs`、`test/relay.test.mjs`。第二部分为 v1 本地导入引擎原文，仍有效。

## 变更 2.3.0：每个模型实测思考档位（低/中/高/超高/极致）

- WorkBuddy 5.8.3 认可的档位（Mac 与 天选 的 app.asar 一致）：minimal/low/medium/high/xhigh/max，中文标签 低/低/中/高/超高/极致；其它值（如 ultra）会被过滤。对话框模型选择器只显示 low/medium/high/xhigh/max（getReasoningEffortItems），minimal 不显示，所以本工具不提供也不探测 minimal。canDisableThinking:false 时选择器不出现「关闭思考」。
- 导入时每个模型：先发一个无效取值（被接受 = 中转站忽略参数 → 保守写低/中/高）；否则并发逐档试 5 档 + none，接受的写进 supportedEfforts，none 决定 canDisableThinking。
- 无效值报错里列出的是全局枚举，不代表该模型支持（smaragents 实测 gpt-6 拒绝 minimal/none），所以必须逐档实测。
- 想要的档位不在支持范围内时改用最接近的档，并在结果页写明。

## 变更 2.2.3（备份文件名修复）

- 写入 models.json 前的备份文件名改为 `models.json.bak.YYYYMMDDHHMMSS`。2.2.2 及更早版本生成的名字以点结尾（如 `.bak.20261024145701.`），Windows 无法正常删除。
- 新增 backupName 单元测试，保证文件名不以点或空格结尾。

## 变更 2.2.2（Windows 自定义安装目录检测）

- Windows：WorkBuddy 装在自定义目录（如 D:\workbuddy）时，改从卸载注册表（DisplayIcon/InstallLocation）和正在运行的 WorkBuddy.exe 找到程序位置。
- 仍找不到程序但已有 ~/.workbuddy/models.json 时，提示后继续导入，不再直接退出。
- 已在真实 Windows 10（WorkBuddy 5.8.3 装在 D 盘）上实测通过。

## 变更 2.2.1（黑灰界面 + 每个模型实测思考强度）

- 界面：默认配色改为中性黑灰（主色 #1F2329，与 WorkBuddy 一致），删除备选配色。
- 思考强度：新增默认选项 `auto`「自动（实测）」。不再按模型名猜：所选的**每个**模型都用 `reasoning_effort=medium` 实测一次（并发 4，单次超时 30s；DeepSeek/Qwen/GLM 被拒时再试各自格式）。接受 → `supportsReasoning:true` + `reasoning{defaultEffort:'medium', supportedEfforts:['low','medium','high'], canDisableThinking:true}`；不接受 → 关闭。用户仍可在网页里逐个改成关闭/低/中/高（手动档位不通过时照旧降级）。CLI `--effort auto` 同此逻辑。

## 变更 2.2.0（网页填写 + 每个模型可选思考强度）

**交互**：不带参数运行（双击 exe / Mac 程序 / .command / .bat）= 网页模式（`lib/wb-web.mjs` + `lib/wb-page.html`）。
- 只监听 `127.0.0.1` 随机端口；页面 URL 带一次性 token（`/?t=`），API 要求 `X-WB-Token` 头；校验 Host（防 DNS rebinding，否则 421）和 Origin（外站 403）；POST 只收 JSON（415）；CSP 禁外部资源。
- 平台令牌 / Key 只存在进程内存，页面只拿到打码后的 Key。
- 点「完成，关闭本工具」退出；导入成功 2 分钟后、或 30 分钟无操作自动退出。
- `--url/--key` 等参数（命令行模式）和 `--interactive`（终端问答）保留给开发者；新增 `--effort auto|off|low|medium|high`。

**WorkBuddy 思考强度字段（只读核对 Tian 的 Mac 上 WorkBuddy 安装包，未改任何文件、未读 Key）**：
- `/Applications/WorkBuddy.app/Contents/Resources/app.asar` 约偏移 76289759：WorkBuddy 自己保存本地自定义模型（SAVE_LOCAL_CUSTOM_MODEL）时写入 `supportsReasoning` 与 `reasoning:{defaultEffort:'medium',supportedEfforts:['low','medium','high'],canDisableThinking:true}` —— 本工具照此格式写。
- 同文件约 78414976 `enrichLanguageModelFromCatalog`：只有 `supportsReasoning` 为 undefined 时才从目录补；所以旧版写死 `supportsReasoning:false` 会让思考强度永远不出现（这就是 2.1.0「默认没有」的原因）。
- 同文件约 89063334 `mapProductModelReasoning`：读取 effort / defaultEffort / supportedEfforts / summary / canDisableThinking。
- 内置模型的缓存 `~/.workbuddy/cache/acc-product-config-v3.json` 中是 `supportsReasoning:true, reasoning:{defaultEffort:'high',supportedEfforts:['low','high','max'],...}`。
- `app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs` 约 3760006 `createCompatibilityRules`：读自定义模型的 `compat` / `thinkingLevelMap`；`withSupportedEffortsFallback` 用 `reasoning.supportedEfforts` 生成 thinkingLevelMap；默认发 OpenAI Chat `reasoning_effort`；约 3750746 ThinkingFormatTranslatorRule 支持 `compat.thinkingFormat` = deepseek / qwen / zai / openrouter / together …；MaxTokensFieldRule 对 o1/o3/o4/gpt-4.1/gpt-5 改用 `max_completion_tokens`。

**思考探测（`lib/wb-reasoning.mjs`）**：对选了思考强度的模型发一次 `POST /chat/completions`（与 WorkBuddy 一致：`reasoning_effort`，o/gpt-5 用 `max_completion_tokens`），要求 JSON + choices；有 `reasoning_content` 或 `reasoning_tokens>0` 记为「已生效」，否则「已接受、无法确认」。被拒绝时 DeepSeek / Qwen / GLM 再试各自格式（成功写 `compat.thinkingFormat`）；仍失败 → 降级为 `supportsReasoning:false`，页面说明原因。

**待确认**：① new-api / sub2api 对 Claude / Gemini 是否把 `reasoning_effort` 转成各自的 thinking 参数，取决于站点版本和渠道配置，由运行时探测决定；② WorkBuddy 界面上自定义模型是否显示「思考强度」一栏——按代码应显示，但尚未在 WorkBuddy 界面实测。

## 变更 2.0.1（真机 bug：sub2api 站点导入后不可用）
- 根因：粘贴模式用站点根地址作 base；旧逻辑「先试原样、再补 /v1」，sub2api 根路径 `/models` 也返回 JSON 模型列表，于是 base 定成了根地址，写入 `<站点>/chat/completions`。该地址是前端页面（HTML 200），而探测只看 2xx，所以误判为可用。
- 修复：base 一律规范为 `<站点>/v1`，不再按根路径试探；探测要求响应 content-type 为 JSON 且含 `choices`；过滤含 `*`/`?` 的通配符模型 id；重跑时自动清理本工具旧版写坏的同站点条目（通配符 id、url 缺 /vN），用户自己写的条目不动。

## 0. 交付形态：纯本地工具（2026-10-24 变更）

- 交付物是一个 zip：`workbuddy-relay-<版本>.zip`。用户解压后双击 `macOS-双击导入.command` 或 `Windows-双击导入.bat`。
- 所有脚本都在包内，**不联网下载自身代码、不需要部署或托管**。联网只有两类：访问用户自己填的中转站，以及未安装 WorkBuddy 时打开官网下载页。
- 运行时：本机有 Node ≥18 就用 Node，否则用 WorkBuddy 自带的 Electron（`ELECTRON_RUN_AS_NODE=1`），用户不用装 Node。
- 交互式引导：站点地址 → 自动识别平台 → 选「平台令牌自动取 Key」或「粘贴 Key」→ 列出可用 Key，可选或新建 → 导入 → 校验。平台令牌失败时自动降级为粘贴。
- 参数模式（`--url --key`、`--platform-token --key-id`）保留，供脚本或测试使用。
- **废弃**：`legacy/index.html` 网页生成 `curl | bash` / `irm | iex` 命令、远程托管脚本的模式。`setup.sh/ps1` 里的远程下载逻辑已删除；包不完整时直接报错，不会去下载。本文第二部分 §4（网页前端）、§6（部署）随之废弃，仅留作参考。

## 1. 用户怎么用（两条路，都不需要平台改造）

| 路 | 用户给什么 | 结果 |
|---|---|---|
| 一键 | 站点地址 + 一个现有凭证（new-api：个人访问令牌 `nap_…`；sub2api：登录 token） | 脚本列出账号下已有的 Key → 用户选一个或新建 `WorkBuddy` → 自动导入 |
| 粘贴 | 从平台网页复制的端点 + Key | 直接导入（v1 流程） |

非交互时（如 `curl | bash`）默认：有名为 `WorkBuddy` 的 Key 就用它，否则用第一个可用的，没有就新建。`--key-id <id|new>` 可显式指定。
拿到 base url + Key 后，复用 v1 五步：检测 WorkBuddy → 拉模型 → 探测 → 合并写入 → 唤起校验。

## 2. 平台识别（公开免登录接口）

- `GET /api/v1/settings/public` 返回 `{code:0, data}` → sub2api
- `GET /api/status` 返回 `{success:true, data}` → new-api
- 都识别不出：凭证以 `nap_` 开头按 new-api，否则按 sub2api；也可 `--relay-type` 指定。

base url 统一为 `<origin>/v1`，写入 WorkBuddy 时拼成 `<origin>/v1/chat/completions`（WorkBuddy 要求完整端点）。

## 3. new-api（QuantumNous/new-api；MaaS v1.0.0-rc.46 定制版，**以下均经 MaaS 对照代码确认 ✅ 2026-10-24**）

| 用途 | 现有接口 | 所需 PAT 权限 |
|---|---|---|
| 列 Key | `GET /api/token/?p=1&page_size=100` → `{success,message,data:{page,page_size,total,items}}`；`items[].key` 为掩码；`status` 1启用 2禁用 3过期 4额度用尽，**只用 1** ✅ | `api_key:read` |
| 取完整 Key | `POST /api/token/:id/key` → `{success,data:{key}}`，**不带 `sk-`**，客户端补 ✅ | `api_key:reveal` |
| 新建 Key | `POST /api/token/` `{name, unlimited_quota:true, expired_time:-1}`（group 不传）→ 只返回 `{success,message}`，**无 id** ✅。name 不唯一、≤50 字符、默认上限 1000 个 → 客户端用唯一名 `WorkBuddy-<yymmdd><4位随机>` 创建，再按 name 精确回查 | `api_key:write` |

- 鉴权 `Authorization: Bearer nap_xxx`，**PAT 不需要 `New-Api-User`** ✅。客户端保留「鉴权失败后用 `/api/user/self` 的 id 带头重试一次」仅作旧版/第三方兜底。
- 默认选择：优先名为 `WorkBuddy` 或 `WorkBuddy-*` 的启用中 Key，避免重复创建。
- 调用地址 = **用户给的站点地址** + `/v1` ✅（第三方站点页面显示的端点可能是内网地址，不采用）。

## 4. sub2api（Wei-Shaw/sub2api）

| 用途 | 现有接口 |
|---|---|
| 列 Key（含明文 key） | `GET /api/v1/keys?page=1&page_size=100` |
| 新建 Key | `POST /api/v1/keys` `{name:"WorkBuddy"}`（响应含完整 key，用默认分组） |

鉴权 `Authorization: Bearer <登录 access_token>`，响应封装 `{code:0, message, data}`。登录 token 会过期，且用户只能从浏览器里取，不如直接复制 Key 方便 → 对 sub2api 用户，页面默认引导「粘贴」那条路，凭证方式作为可选。

## 5. 安全

- 不经手账号密码；凭证只在本机内存中使用，不落盘、不打日志（只显示掩码）。
- 建议用户给 PAT 只勾 `api_key:read/reveal/write`，用完可在平台吊销。
- 站点为 http 时照常导入但提示明文风险（MaaS 线上目前是 http）。
- Key 写入沿用 v1：写前备份、权限 600、`wbImportOwner` 标记。

## 6. 测试

单测 17/17 通过；端到端 5/5 通过（`test/e2e/run-e2e.py`：本地 mock new-api/sub2api + 真 TTY 交互 + 临时 HOME + 模拟 WorkBuddy 热加载缓存，覆盖 new-api 新建/选已有、sub2api 令牌/粘贴、令牌错误降级粘贴）：平台识别、new-api 默认复用 / 指定 / 新建 + reveal 补 `sk-`、`New-Api-User` 失败重试、缺 reveal 权限报错、sub2api 列表 / 新建 / 401、缺凭证提示。
待做真实联调：MaaS（new-api rc.46）+ 一个第三方 sub2api；macOS / Windows 各一台；导入后在 WorkBuddy 发一次带工具调用的对话。

## 7. 待确认（都是现有接口行为，不需要平台改代码）

（内部沟通记录未开源。）

---

# 第二部分 · 本地导入引擎（v1 原文，仍有效）

# WorkBuddy 中转站一键接入 · 设计方案与实施手册

> 版本 1.0 · 2026-10-24
> 面向：自己部署这套东西的人（也就是你）
> 配套代码：本目录下的 `wb-setup.mjs` / `lib/` / `bootstrap/`

---

## 0. 一句话结论

**这个工具的本质不是"安装器"，而是一个"配置文件写入器 + 模型探测器的组合"。**

用户在网页上点一下拿到一条命令，粘到终端回车，程序在本地跑五步（检测 → 连接 → 探测 → 写入 → 校验），WorkBuddy 一秒内热加载生效，全程不需要重启、不需要装 Node、不需要装任何东西。

之所以能这么轻，靠的是一个关键事实：**WorkBuddy 自己就是 Electron 应用，可以直接当 Node 22 运行时使用**。所以只要用户装了 WorkBuddy，我们就一定有一个 JS 环境可用——而没装 WorkBuddy 的人本来也没什么可导入的。

---

## 1. 必须先知道的三个事实

这三条是整个方案的基石，都经过实机验证，不是推测。

### 事实一：配置真源是一个 JSON 文件

| 平台 | 路径 |
|---|---|
| macOS | `~/.workbuddy/models.json` |
| Windows | `%USERPROFILE%\.workbuddy\models.json` |

文件允许两种形态，程序必须都能读、并且**保持原有形态写回**：

```jsonc
// 形态 A：裸数组
[
  { "id": "gpt-5.5", "name": "gpt-5.5", "vendor": "Custom",
    "url": "https://relay.example.com/v1/chat/completions",
    "apiKey": "sk-xxx", "supportsToolCall": true, "useCustomProtocol": false }
]
```

```jsonc
// 形态 B：对象（可选带 availableModels）
{
  "models": [ /* 同上 */ ],
  "availableModels": ["gpt-5.5"]
}
```

> **坑：`availableModels` 是全局白名单，不是"额外可用"**。一旦写了这个字段，没列进去的内置模型会从选择器里消失。所以默认策略是：**原文件没有这个字段就绝对不要新增**；有的话只做并集。代码里就是这么做的。

### 事实二：改完不用重启，1 秒内生效

应用用 `fs.watch` 监听 `models.json`，1 秒防抖后触发配置同步。实测：写入后约 1 秒，应用侧缓存 `~/.workbuddy/cache/acc-product-config-v3.json` 的模型数量立即增加。

**这条直接决定了写盘方式**：必须原地覆盖内容，不能 `tmp + rename` 交给别的机制——虽然实测 macOS 上 rename 也能触发（watcher 会重新绑定），但 Windows 上 rename 常被杀软或文件索引占用挡成 `EPERM`。所以：

- Windows → **原地覆盖 + 失败重试**（最多 6 次，每次退避 150ms）
- macOS / Linux → `tmp + rename` 原子替换

### 事实三：`url` 必须是完整端点

```jsonc
"url": "https://relay.example.com/v1/chat/completions"   // ✅ 正确
"url": "https://relay.example.com/v1"                    // ❌ 运行时不会自动补
```

应用里有一个"补全路径"的函数，但它只在**测试连接**那个界面里跑，实际发请求时不会补。所以导入时必须自己拼好 `/chat/completions`。

例外：`useCustomProtocol: true` 时 url 被原样使用——这个我们不用，保持 `false`。

### 附带事实：运行时模型 ID 会被改写

写进文件的 `id: "gpt-5.5"`，在应用内部会变成 `custom-local:gpt-5.5` 并打上 `custom` 标签。这一点在最后一步校验时要用到（去缓存里找带前缀的 id）。

---

## 2. 整体架构

```
你的站点（静态托管）
├── index.html            ← 用户看到的网页，生成命令
├── workbuddy/
│   ├── setup.sh          ← macOS 引导
│   ├── setup.ps1         ← Windows 引导
│   ├── wb-setup.mjs      ← 五步编排器
│   └── lib/
│       ├── wb-core.mjs       ← 纯逻辑（跨平台共享）
│       └── wb-platform.mjs   ← 平台差异（检测/启动/安装）

用户本地
├── WorkBuddy.app / WorkBuddy.exe   ← 提供 JS 运行时
└── ~/.workbuddy/models.json        ← 写入目标
```

**分层的意义**：`wb-core.mjs` 一行平台判断都没有，可以单测、可以复用到别的工具；所有 os 相关的脏活全在 `wb-platform.mjs` 里。改 bug 时基本只需要动一层。

### 引导脚本为什么要存在

因为要解决"用户没有 Node"这件事。引导脚本只做三件事：

1. 找到 WorkBuddy（顺带确认用户装没装）
2. 选运行时：有 Node ≥18 就用 Node，没有就用 WorkBuddy 自己的可执行文件（设 `ELECTRON_RUN_AS_NODE=1`）
3. 把 `wb-setup.mjs` 和 `lib/` 下载到临时目录，传参执行

macOS 实测：`ELECTRON_RUN_AS_NODE=1 "/Applications/WorkBuddy.app/Contents/MacOS/Electron" -v` 返回 `v22.21.1`，`fetch`、`process.env`、`process.argv` 全部正常工作。

---

## 3. 五步流程详解

### 步骤 1 · 检测 WorkBuddy

要拿到四样东西：**装没装、装在哪、什么版本、是否在运行**。

| | macOS | Windows |
|---|---|---|
| 路径 | `/Applications/WorkBuddy.app`、`~/Applications/`，兜底用 Spotlight：`mdfind 'kMDItemCFBundleIdentifier == "com.tencent.workbuddy.mac"'` | `%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe`、`%ProgramFiles%`、`%ProgramFiles(x86)%`，**最权威的是注册表 `App Paths\WorkBuddy.exe`** |
| 版本 | `PlistBuddy -c "Print :CFBundleShortVersionString" Contents/Info.plist` | `(Get-Item exe).VersionInfo.ProductVersion`，兜底查 Uninstall 项的 `DisplayVersion` |
| 运行状态 | `pgrep -f "WorkBuddy.app/Contents/MacOS"` | `tasklist /FI "IMAGENAME eq WorkBuddy.exe"` |

**没装怎么办**：打开下载页，然后退出（退出码 2）。别试图自己爬官方 CDN 拿安装包——官网是 SPA，`/download` 是 404，下载区块是懒加载 chunk，没有稳定直链，版本一变就废。想全自动的话用 `--installer <dmg/exe 路径或 URL>`，把安装包托管在你自己的服务器上。

**已装在跑怎么办**：不用管。热加载会处理，写完自然生效。

### 步骤 2 · 连接中转站并发现模型

```
GET {base}/models
Authorization: Bearer sk-xxx
```

`{base}` 有两种可能：`https://host` 或 `https://host/v1`。用户永远说不清，所以**两种都试**（顺序：原样 → 补 `/v1`）。返回结构也要兼容四种：

```jsonc
{ "data": [{ "id": "..." }] }     // OpenAI / New API / One API 标准
{ "models": [{ "id": "..." }] }   // 部分实现
{ "models": ["..."] }
["..."]
```

**401 / 403 必须立刻终止**，不要往下试。这是最常见的问题，早失败早报错，用户看一眼就知道 Key 错了。

**如果站点根本没实现 `/models`**（部分中转站会 404），退回手动模式：`--models gpt-5.5,claude-opus-4,deepseek-v3`。此时用一次探测来确定 base 到底要不要 `/v1`。

### 步骤 3 · 探测可用性 ← 最容易被忽略但最重要的一步

对每个候选模型发一次极小请求：

```jsonc
POST {base}/chat/completions
{ "model": "xxx", "messages": [{"role":"user","content":"ping"}], "max_tokens": 1, "stream": false }
```

这一步一次性解决四个问题：

| 问题 | 探测怎么回答的 |
|---|---|
| Key 有效吗 | 401/403 → 直接终止整个流程 |
| 地址要不要 `/v1` | 404 → 换另一种写法重试 |
| 这个模型真能用吗 | 非 2xx → 标记不可用，不写入 |
| 是不是聊天模型 | 先按名字过滤 embed / rerank / tts / whisper / dall / ocr / vl-ocr 等 |

**为什么必须有**：中转站的 `/models` 往往返回几十上百个条目，其中大量是用户没权限、欠费、或者只是转发上游的元数据。不探测就全写进去，用户打开模型选择器看到二十个选项，选哪个都报错——他会认定"这工具坏了"。探测过之后只留能跑的，通常剩 3~8 个，列表干净。

并发度设 4，超时 12 秒。之前实测过：全并发会把某些站点的限流打出来，造成假阴性。

> 想跳过就用 `--no-probe`，但要接受"导入的模型未必都能用"。

### 步骤 4 · 写入配置

写入逻辑有五个讲究：

1. **先备份**：`models.json.bak.YYYYMMDDHHMMSS`
2. **按 `id + host` 去重合并**：同 id 同站点 → 更新；同 id 不同站点（比如两家中转站都有 `gpt-5.5`）→ **跳过并提示**，因为覆盖会毁掉用户原来那条
3. **保留原有形态**：原文件是数组就写数组，是对象就写对象，其他字段原样保留
4. **打所有权标记**：每条写入的模型带 `wbImportOwner: "wb-setup-v1"`，将来 `--prune` 只清理带这个标记的，不碰用户自己的
5. **权限 600**（Windows 无此语义，自动跳过）

单条记录的完整字段：

```jsonc
{
  "id": "gpt-5.5",
  "name": "gpt-5.5",              // 可加前缀便于识别，如 "Relay·gpt-5.5"
  "vendor": "Custom",
  "url": "https://relay.example.com/v1/chat/completions",
  "apiKey": "sk-xxx",
  "maxInputTokens": 200000,
  "maxOutputTokens": 8192,
  "supportsToolCall": true,        // 必须 true，否则 Agent 干不了活
  "supportsImages": false,
  "supportsReasoning": false,
  "useCustomProtocol": false,
  "wbImportOwner": "wb-setup-v1"   // 自建字段，应用会忽略，我们自己用来做清理
}
```

### 步骤 5 · 唤起并校验

先唤起：`open -a /Applications/WorkBuddy.app` + `open workbuddy://home`（Windows 用 `start "" exe` + `start "" workbuddy://home`）。

然后**轮询应用侧缓存**，最多 8 秒：

```js
~/.workbuddy/cache/acc-product-config-v*.json  →  models[] 里找
  id === "gpt-5.5"  或  id === "custom-local:gpt-5.5"
```

三种结果，对应三种提示：

| 结果 | 说明 | 提示 |
|---|---|---|
| 找到 | 应用真的吃进去了 | ✓ 热加载完成，无需重启 |
| 有缓存但没找到 | 应用可能还没启动完 | ! 稍等几秒再看模型选择器 |
| 没有缓存文件 | 应用从来没启动过 | ! 配置已就绪，下次启动生效 |

**这一步是这个方案和别人最大的差别**：别人写完文件就说"成功"，但"文件写成功"和"应用认了"是两件事。校验过才敢说成功。

---

## 4. 网页前端方案（⚠️ 已废弃，见第一部分 §0）

你选了网页，这是对的选择——一份页面同时服务两个系统，不用维护两个安装包，也不用处理代码签名。但有几个硬约束必须提前知道。

### 4.1 浏览器不能执行本地命令

这是沙盒限制，无法绕过。所以"一键"在网页上只有一个可实现形态：

```
用户点按钮  →  网页把命令生成好并复制到剪贴板  →  用户粘到终端回车
```

剩下 90% 的复杂度（找安装路径、选运行时、探测模型、合并写盘）都在那条命令跑起来之后自动完成。**用户的实际操作是"点一下 + 粘一次 + 回车"**，这已经足够接近一键了。

如果哪天你要求"真的零终端"，只有一条路：做一个本地常驻程序注册 `wb-relay://` 自定义协议，网页上点按钮直接唤起它。但那要求用户先装一次，且要处理签名和自动更新，是第二阶段的事。

### 4.2 系统识别

三种方法，建议组合使用：

```js
// 1. 首选：Client Hints（Chrome / Edge 113+，需要 https）
const { platform } = await navigator.userAgentData?.getHighEntropyValues?.(['platform']) || {}

// 2. 兜底：UA 字符串
const ua = navigator.userAgent
const isWin = /Windows/i.test(ua) || platform === 'Windows'
const isMac = /Macintosh|Mac OS X/i.test(ua) || platform === 'macOS'
```

**永远同时把两个系统的命令都显示出来**，只把用户系统的那个放在前面并标"推荐"。判断错的代价是用户复制了错命令、看到一堆报错，比多点一下严重得多。

### 4.3 Key 怎么传进网页（安全重点）

**不要用 query string 传 Key。**

```
❌ https://yoursite.com/setup?key=sk-xxx
```

原因：query 会出现在服务器访问日志、浏览器历史、以及页面里任何外链请求的 `Referer` 头里。等于把 Key 广播出去。

三个更安全的做法，按推荐排序：

| 做法 | 说明 |
|---|---|
| **URL fragment**：`https://yoursite.com/setup#key=sk-xxx` | fragment 不会发送给服务器，只留在浏览器本地。前端用 `location.hash` 读。**改动最小，推荐** |
| 网页上手动粘贴 | 最安全，但多一步操作 |
| 后端换一次性 token | 最严谨：网页只带 `#t=<一次性token>`，脚本再拿 token 换 Key。适合有后端的情况 |

### 4.4 命令里带 Key 会进 shell history

`--key sk-xxx` 会被记进 `~/.zsh_history` / PSReadLine 历史。如果在意，让脚本交互式读 Key：

```bash
# 安全版：不把 Key 写在命令行里
curl -fsSL https://YOURSITE/workbuddy/setup.sh | bash -s -- --url https://relay.example.com
# 脚本检测到 --key 为空时，用 read -s 提示输入（不回显）
```

建议**两种都给**：默认给完整版（省事），页面上加一个"不想让 Key 出现在历史里？"的折叠，展开是安全版命令。

### 4.5 页面代码

一个能直接用的精简版（无框架，约 150 行，含错误处理和复制兜底）：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>一键接入 WorkBuddy</title>
<style>
  :root { --fg:#111; --muted:#666; --line:#e5e5e5; --bg:#fff; --soft:#f7f7f7; --accent:#185fa5; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#eee; --muted:#999; --line:#333; --bg:#141414; --soft:#1d1d1d; --accent:#85b7eb; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:48px 20px; font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;
         color:var(--fg); background:var(--bg); }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 500; margin: 0 0 8px; }
  .sub { color: var(--muted); margin: 0 0 32px; font-size: 14px; }
  .card { border:1px solid var(--line); border-radius:10px; padding:20px; margin-bottom:16px; }
  .card.dim { opacity:.55; }
  .tag { display:inline-block; font-size:12px; padding:1px 7px; border-radius:4px;
         background:var(--soft); color:var(--muted); margin-left:8px; vertical-align:2px; }
  .tag.rec { background:var(--accent); color:#fff; }
  pre { background:var(--soft); border:1px solid var(--line); border-radius:8px; padding:14px;
        overflow-x:auto; font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
        margin:12px 0; white-space:pre-wrap; word-break:break-all; }
  button { font:inherit; font-size:14px; padding:9px 18px; border-radius:8px; cursor:pointer;
           border:1px solid var(--line); background:var(--soft); color:var(--fg); }
  button:hover { border-color: var(--accent); }
  button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  .steps { color:var(--muted); font-size:13.5px; line-height:1.9; padding-left:20px; margin:0; }
  .note { font-size:13px; color:var(--muted); margin-top:8px; }
  code { background:var(--soft); padding:1px 5px; border-radius:3px; font-size:12.5px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>一键接入 WorkBuddy</h1>
  <p class="sub">把下面的命令复制到终端执行。全程约 15 秒，装完不用重启。</p>

  <div class="card" id="card-mac">
    <div><strong>macOS</strong><span class="tag" id="tag-mac">推荐</span></div>
    <pre id="cmd-mac"></pre>
    <button class="primary" data-copy="mac">复制命令</button>
    <p class="note">打开「终端」（Terminal），粘贴回车即可。不需要管理员密码。</p>
  </div>

  <div class="card" id="card-win">
    <div><strong>Windows</strong><span class="tag" id="tag-win"></span></div>
    <pre id="cmd-win"></pre>
    <button class="primary" data-copy="win">复制命令</button>
    <p class="note">在「开始菜单」搜索 <code>PowerShell</code> 打开，粘贴并回车。</p>
  </div>

  <div class="card">
    <div><strong>它会做什么</strong></div>
    <ol class="steps">
      <li>检测 WorkBuddy 装在哪、什么版本、是否在运行</li>
      <li>连接中转站，拉取你的可用模型列表</li>
      <li>逐个验证模型是否真的可用，把用不了的剔掉</li>
      <li>写入配置（会先备份原来的）</li>
      <li>唤起 WorkBuddy，并确认配置真的生效</li>
    </ol>
  </div>
</div>

<script>
const SITE = 'https://YOURSITE.com/workbuddy';   // ← 改成你的静态托管地址
const RELAY = 'https://relay.example.com';       // ← 改成你的中转站地址

// Key 从 fragment 读，不用 query，避免进 Referer 和服务器日志
const key = new URLSearchParams(location.hash.slice(1)).get('key') || '';

function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function pq(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

const cmds = {
  mac: `curl -fsSL ${SITE}/setup.sh | bash -s -- --url ${q(RELAY)}` + (key ? ` --key ${q(key)}` : ''),
  win: `$env:WB_RELAY_URL=${pq(RELAY)}; $env:WB_RELAY_KEY=${pq(key)}; irm ${SITE}/setup.ps1 | iex`
};

for (const k of ['mac', 'win']) document.getElementById('cmd-' + k).textContent = cmds[k];

// 只做"高亮推荐"，不隐藏另一个系统的命令
const ua = navigator.userAgent;
const isWin = /Windows/i.test(ua);
document.getElementById('tag-mac').className = 'tag' + (isWin ? '' : ' rec');
document.getElementById('tag-win').className = 'tag' + (isWin ? ' rec' : '');
if (isWin) {
  // 只在视觉上把 Windows 卡片提到前面，两张卡都始终保留
  document.getElementById('card-mac').before(document.getElementById('card-win'));
  document.getElementById('tag-mac').textContent = '';
  document.getElementById('tag-win').textContent = '推荐';
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const ok = await copy(cmds[btn.dataset.copy]);
    const old = btn.textContent;
    btn.textContent = ok ? '已复制，去终端粘贴' : '复制失败，请手动选中';
    setTimeout(() => { btn.textContent = old; }, 2200);
  });
});

if (!key) {
  document.querySelector('.sub').textContent =
    '警告：链接里没有带上 API Key，命令执行后需要手动输入。建议从正确入口重新进入。';
}
</script>
</body>
</html>
```

**注意**：`navigator.clipboard` 需要 https（或 localhost），http 站点会失败——所以代码里留了 `execCommand` 兜底，但 http 页面下体验会差一点。**用 https 部署**。

---

## 5. 跨平台差异总表

这些是实际写代码时会遇到的，逐条记下来：

| 环节 | macOS | Windows |
|---|---|---|
| 找安装 | `/Applications` + Spotlight `mdfind` | 常见目录 + 注册表 `App Paths`（最权威） |
| 读版本 | `PlistBuddy` | `VersionInfo.ProductVersion` / Uninstall 项 |
| 判断运行 | `pgrep -f` | `tasklist /FI` |
| 启动应用 | `open -a <app>` | `start "" <exe>` |
| 唤起窗口 | `open workbuddy://home` | `start "" workbuddy://home` |
| 写文件 | `tmp + rename`（原子） | **原地覆盖 + 重试**（rename 可能 EPERM） |
| 文件权限 | `chmod 600` | 无此语义，跳过 |
| 引导方式 | `curl -fsSL ... \| bash -s --` | `$env:X=...; irm ... \| iex` |
| 传参 | `bash -s -- --url x --key y` | **只能走环境变量**（`iex` 不接受参数） |

### Windows 上三个必须处理的坑

**坑 1 · `.ps1` 文件必须全 ASCII**
Windows PowerShell 5.1 读无 BOM 的 UTF-8 脚本会乱码成天书。写中文注释 → 用户看到一屏乱码，甚至语法错误。所以 `setup.ps1` 里一句中文都没有，提示全用英文。

**坑 2 · `irm | iex` 模式绝对不能 `exit`**
管道执行时没有 `$PSScriptRoot`，脚本活在用户自己的 PowerShell 会话里。此时调 `exit 1` 会**直接把用户的窗口关掉**——用户会以为程序崩了。正确做法：

```powershell
$script:Piped = -not $PSScriptRoot
function Die($m) {
  Write-Host "  x $m" -ForegroundColor Red
  if ($script:Piped) { throw $m } else { exit 1 }
}
```

**坑 3 · `WorkBuddy.exe` 是 GUI 子系统程序**
用 `&` 直接调用既不等待、也不显示输出（它以为自己是个窗口程序）。必须：

```powershell
Start-Process -FilePath $runtime -ArgumentList $argLine -NoNewWindow -Wait -PassThru
```

`-NoNewWindow` 把它挂到当前控制台，`-Wait` 等它跑完，这样才能看到进度和拿到退出码。

### macOS 的两个注意点

- **兼容 bash 3.2**：系统自带的是 bash 3.2，不支持关联数组、不支持 `${var^^}`。要写成 POSIX 友好的形式，参数处理用 `while/case` 而不是 `getopts`。
- **`curl | bash` 不触发 Gatekeeper**：只有 Finder 打开或浏览器下载的文件才带 `com.apple.quarantine` 属性。curl 下载的不带，所以不会弹"无法验证开发者"。但反过来，如果你要分发 `.dmg`，就**必须**做公证（notarization），否则用户双击会被拦。

---

## 6. 部署步骤（⚠️ 已废弃：现为纯本地 zip，见第一部分 §0）

### 6.1 必须改的四个值

代码里留了占位符，上线前一定要改，否则全部报错：

| 文件 | 位置 | 改成 |
|---|---|---|
| `bootstrap/setup.sh` | 第 16 行 `SRC_BASE` | 你的静态托管地址，如 `https://yoursite.com/workbuddy` |
| `bootstrap/setup.ps1` | 第 24 行 `$SrcBase` 默认值 | 同上 |
| 两个脚本的 `DOWNLOAD_PAGE` | | WorkBuddy 下载页（可换成你的邀请链接） |
| `index.html` | `SITE` / `RELAY` 常量 | 你的托管地址 / 中转站地址 |

### 6.2 目录结构（上传到静态服务器就这些）

```
/                            ← 站点根
├── index.html
└── workbuddy/
    ├── setup.sh
    ├── setup.ps1
    ├── wb-setup.mjs
    └── lib/
        ├── wb-core.mjs
        └── wb-platform.mjs
```

`wb-import.mjs` 和 `test/` 不用传，是给开发和调试用的。

### 6.3 托管要求

- **必须 https**（剪贴板 API 需要，也更可信）
- Content-Type 要正确：`.mjs` 最好是 `text/javascript`，退一步 `application/octet-stream` 也能被 `fetch` 读，但有的 CDN 会强改。如果发现下载下来的文件被 HTML 包裹了，检查这一项。
- 不需要任何后端、不需要数据库。整套东西是纯静态的。

### 6.4 前置程序怎么对接

假设那个"能提供 apiKey 和 url"的程序是你自己的，两种对接方式：

**方式 A：直接拼链接**（最简单）

你的程序生成 `https://yoursite.com/#key=sk-xxx`，用户点进来就行。前端从 fragment 读 Key。

**方式 B：网页上让用户自己填**

如果不想在 URL 里带 Key，页面上加一个输入框，用户把自己的 Key 粘进去，前端实时重新生成命令。这样 Key 完全不进 URL。

```js
input.addEventListener('input', () => {
  key = input.value.trim();
  document.getElementById('cmd-mac').textContent = build('mac');
  document.getElementById('cmd-win').textContent = build('win');
});
```

**方式 C：给程序化调用准备的接口**

`wb-import.mjs` 支持 stdin 输入，方便被别的程序当库调：

```bash
echo '{"url":"https://relay.example.com","key":"sk-xxx","models":["gpt-5.5"]}' \
  | node wb-import.mjs --stdin-json
```

`wb-setup.mjs` 支持 `--json` 输出结构化结果，便于上层解析：

```jsonc
{ "platform": "darwin", "ok": true, "steps": { "detect": {...}, "connect": {...}, "probe": {...},
  "write": {...}, "verify": {...} }, "models": ["gpt-5.5"], "errors": [] }
```

---

## 7. 上线前验证清单

按顺序走一遍，每一项都能独立判断对错：

- [ ] **本地跑通**：`node wb-setup.mjs --url https://你的中转站 --key sk-xxx --config /tmp/t/models.json --no-launch`
      → 五步全部打勾，`/tmp/t/models.json` 里出现预期条目
- [ ] **真实配置验证**：去掉 `--config` 跑一次，然后新建一个会话看模型选择器里「自定义」分组有没有新模型
- [ ] **确认没破坏原配置**：`cat ~/.workbuddy/models.json`，原有条目数量不变，只是多了新条目
- [ ] **错误 Key 路径**：故意写错一个 Key，应该在第 2 步就停下并提示 401，而不是写完一堆废配置
- [ ] **无 Node 环境**：把 PATH 里的 node 去掉再跑引导脚本
      `env -i HOME="$HOME" PATH=/usr/bin:/bin bash bootstrap/setup.sh --url ... --key ...`
      → 应该自动切到 WorkBuddy 内置 Electron
- [ ] **curl 下载分支**：从远端真跑一次 `curl -fsSL https://yoursite/workbuddy/setup.sh | bash -s -- ...`
- [ ] **Windows 实机**（最重要，我这台机器测不了）：重点看三处——
      ① 注册表 App Paths 拿到的路径对不对；② `Start-Process` 的输出在控制台可见；③ `models.json` 有没有被占用导致写失败
- [ ] **网页在两种系统上各点一次**，确认推荐标签和命令内容都正确

---

## 8. 已知限制

诚实列出来，避免上线后被用户当 bug 报：

| 限制 | 原因 | 缓解 |
|---|---|---|
| 网页无法直接执行命令，需要用户粘贴 | 浏览器沙盒 | 真的零终端要本地常驻程序 + 自定义协议 |
| 无法自动安装 WorkBuddy | 官方无稳定安装包直链 | 打开下载页；或用 `--installer` 自己托管安装包 |
| 老会话可能沿用旧配置 | 会话创建时已绑定模型列表 | 提示用户"新建会话"最稳 |
| `supportsImages` / `supportsReasoning` 默认 false | 探测时没测多模态能力 | 需要的话按模型名匹配开启，或让用户在应用里手动改 |
| 探测会消耗额度 | 每个模型一次请求 | `max_tokens: 1`，成本可忽略；可用 `--no-probe` 跳过 |
| Windows 未实机验证 | 开发机是 macOS | 上线前必须找人跑一遍 |
| 部分站点不支持 `/models` | 实现差异 | `--models a,b,c` 手动指定 |

---

## 9. 附录

### 9.1 完整 CLI 参数（wb-setup.mjs）

| 参数 | 说明 |
|---|---|
| `--url <base>` | 中转站地址，`https://host` 或 `https://host/v1` 都行 |
| `--key <sk-...>` | API Key |
| `--models a,b,c` | 指定模型，跳过自动发现 |
| `--vendor <name>` | 供应商显示名，默认 `Custom` |
| `--name-prefix <s>` | 模型名前缀，如 `Relay·`，便于在列表里区分来源 |
| `--max-models <n>` | 最多导入几个，默认 12 |
| `--config <path>` | 覆盖 `models.json` 路径（测试必备） |
| `--installer <path\|url>` | 未安装时用它自动安装（.dmg / .exe） |
| `--download-page <url>` | 未安装且无 installer 时打开的页面 |
| `--no-probe` | 跳过逐个探测（快，但可能导入用不了的模型） |
| `--no-launch` | 导入后不唤起 WorkBuddy |
| `--dry-run` | 只演练，不写盘 |
| `--json` | 输出结构化结果 |

### 9.2 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 一般错误（Key 无效、地址不通、全部模型探测失败） |
| 2 | 未安装 WorkBuddy |

### 9.3 排查对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| `鉴权失败 (HTTP 401)` | Key 无效或已过期 | 去中转站重新生成 |
| `无法从 /models 获取模型列表` | 站点没实现该接口 | 用 `--models` 手动指定 |
| 写了配置但选择器里没有 | 应用没启动过 / 看的是老会话 | 启动一次 WorkBuddy，新建会话 |
| 所有模型都探测失败 | 余额不足 / 站点的 `/chat/completions` 路径不同 | 用 `--no-probe` 先写进去，再在应用里手动测 |
| 内置模型全消失了 | 误写了 `availableModels` | 从备份 `models.json.bak.*` 恢复，删掉该字段 |
| Windows 写入报 `EPERM` | 文件被杀软/索引占用 | 程序会自动重试 6 次；仍失败则退出杀软实时防护重试 |

### 9.4 文件清单

| 文件 | 作用 | 是否上传 |
|---|---|---|
| `wb-setup.mjs` | 五步编排器，主入口 | ✅ |
| `lib/wb-core.mjs` | 纯逻辑：URL 归一化 / 发现 / 探测 / 合并 / 写盘 / 校验 | ✅ |
| `lib/wb-platform.mjs` | 平台层：检测 / 启动 / 安装 | ✅ |
| `bootstrap/setup.sh` | macOS 引导 | ✅ |
| `bootstrap/setup.ps1` | Windows 引导 | ✅ |
| `wb-import.mjs` | 只导入不检测的极简 CLI | 可选 |
| `test/core.test.mjs` | 7 个单元测试，`node --test test/` | ❌ |

---

## 10. 如果要继续往下做

按投入产出排序：

1. **加一个"安全版命令"折叠**（半小时）：不把 Key 写在命令行里，改成脚本交互读取。解决 shell history 泄露问题。
2. **探测时带上 function schema**（1 小时）：现在 `supportsToolCall` 是硬编码 `true`，如果某个模型其实不支持工具调用，用户在 Agent 里会莫名报错。探测时塞一个假的 function 定义，看返回里有没有 `tool_calls`，就能真实判断。
3. **失败诊断建议**（2 小时）：现在报 401 就只报 401。可以加一层——401 时提示"检查 Key 是否过期"，超时时提示"检查是否需要代理"，全部模型失败时提示"检查余额"。用户体验差别很大。
4. **托盘工具 + `wb-relay://` 协议**（2~3 天）：真正的一键。要做 mac 公证和 Windows 签名，且需要用户预装。只有在你确定用户量大、且愿意承担签名成本时才值得做。

---

*文档结束。代码在 `wb-import/` 目录下，可直接改；有任何一步行为和文档不一致，以代码为准，然后告诉我，我来改文档。*
