<!-- purpose: WorkBuddy 上游思考能力声明 UI 隔离渲染证据 -->
- 创建时间: 2026-11-03 20:27:00
- 更新时间: 2026-11-03 20:27:00
- 执行面: local / headless Chrome / synthetic upstream metadata

# WorkBuddy UI 证据

当前页面只将 Base URL `/models` 返回的声明展示给用户：声明档位显示为“按上游默认/低/高”等；没有声明显示“按上游声明”，不自行生成低、中、高。`mandatory=true` 的模型不显示“关闭”。页面明确写“上游声明”，不再称“实测”或“自动降级”。

复查命令：

```sh
PATH=/Users/tian/.nvm/versions/node/v24.12.0/bin:$PATH /Users/tian/.nvm/versions/node/v24.12.0/bin/node docs/1103-shared-reasoning/ui/verify.mjs
```

结果见 `results.json`，覆盖 390/1440 视口，声明模型、无声明模型、mandatory 模型，且无横向溢出。截图为 `declaration-390.png` 与 `declaration-1440.png`。全部数据是合成值，没有真实 Key、真实模型请求或本机 WorkBuddy 配置写入。

实现文件：`workbuddy/lib/wb-page.html`，生成文件 `workbuddy/lib/wb-page.mjs`。生成命令：

```sh
/Users/tian/.nvm/versions/node/v24.12.0/bin/node workbuddy/lib/build-page.mjs
```
