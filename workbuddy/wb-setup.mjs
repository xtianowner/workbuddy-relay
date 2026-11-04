#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import crypto from 'node:crypto';
import { VERSION, PROTOCOLS, assertClientProtocol, normalizeBase, discoverModels, defaultConfigPath, pickChatModels } from './lib/wb-core.mjs';
import { PLATFORM_BASE } from './lib/wb-brand.mjs';
import { acquireCredentials } from './lib/wb-relay.mjs';
import { EFFORTS } from './lib/wb-reasoning.mjs';
import { runImport } from './lib/wb-flow.mjs';
import { getLogger } from './lib/wb-logs.mjs';
import { startWebServer } from './lib/wb-web.mjs';
import { detect, launch, focus, openBrowser, installMacDmg, installWinExe } from './lib/wb-platform.mjs';

const BOOL = ['web', 'interactive', 'dry-run', 'yes', 'no-probe', 'no-launch', 'json', 'help', 'version', 'install', 'prune'];
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const option = process.argv[i];
  if (!option.startsWith('--')) continue;
  const raw = option.slice(2), name = raw.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  args[name] = BOOL.includes(raw) ? true : process.argv[++i];
}
if (args.help) {
  console.log(`WorkBuddy WorkBuddy Relay ${VERSION}
  无参数双击：打开本地网页，填写 API Key 并选择模型。
  --key <key>             API Key（也可用 WB_RELAY_KEY 环境变量）
  --web                   打开本地网页
  --interactive           终端填写 Key
  --models a,b,c          指定模型
  --effort <effort>       ${EFFORTS.join(' | ')}
  --protocol <protocol>   ${PROTOCOLS.join(' | ')}
  --export-logs <zip>     导出本机历史日志（无需 WorkBuddy 或 Key）
  --config <path>         models.json 路径
  --no-probe              跳过生成连通性探测，仍读取上游声明
  --no-launch             不启动 WorkBuddy
  --dry-run               预览，不写入配置
  --json                  JSON 结果
  开源开发接口：--url <base>、--platform-token <token>、--key-id <id|new>。
  平台默认地址：${PLATFORM_BASE}`);
  process.exit(0);
}
if (args.version) { console.log(VERSION); process.exit(0); }
const logger = getLogger(VERSION), operationId = crypto.randomUUID();
let rl;
const closeAsk = () => { rl?.close(); rl = null; };
function die(error, code = 1) {
  closeAsk();
  const message = String(error?.message || error);
  logger.record('startup.failed', { error, message }, 'error', operationId);
  console.error(`\n✗ ${logger.sanitize(message)}\n操作编号：${operationId}\n日志：${logger.status().dir}\n可使用 --export-logs <zip路径> 导出历史日志。`);
  if (args.json) console.log(JSON.stringify({ ok: false, error: logger.sanitize(message), operationId }));
  process.exit(code);
}
process.on('uncaughtException', (error) => die(error));
process.on('unhandledRejection', (error) => die(error));
process.on('exit', (code) => logger.record('process.exit', { code }));
process.on('SIGINT', () => { logger.record('session.interrupted'); process.env.WB_NO_HOLD = '1'; process.exit(130); });

async function main() {
  if (args.exportLogs) {
    const bundle = logger.exportBundle();
    const target = path.resolve(args.exportLogs);
    // Avoid silently overwriting an existing archive.
    fs.writeFileSync(target, bundle.data, { flag: 'wx', mode: 0o600 });
    console.log(`已导出：${target}`); return;
  }
  const platformToken = args.platformToken || process.env.WB_PLATFORM_TOKEN;
  let key = args.key || process.env.WB_RELAY_KEY;
  let base = normalizeBase(args.url || process.env.WB_RELAY_URL || PLATFORM_BASE);
  logger.addSecret(key); logger.addSecret(platformToken);
  const web = args.web || (!key && !args.interactive && !args.json && !platformToken);
  console.log(`WorkBuddy · WorkBuddy 一键导入 v${VERSION}\n本地日志：${logger.status().dir}`);
  const app = process.env.WB_SKIP_DETECT === '1' ? { installed: true, running: true, platform: process.platform, version: 'test' } : detect();
  app.configExists = fs.existsSync(defaultConfigPath(args.config));
  logger.record('workbuddy.detected', { ...app, configPath: defaultConfigPath(args.config) }, 'info', operationId);
  if (web) {
    if (!args.noLaunch && !app.running && app.installed && process.env.WB_SKIP_DETECT !== '1') {
      const launched = launch(app); logger.record('workbuddy.launched', { launched });
    }
    const srv = await startWebServer({ app, configPath: args.config, logger, log: (message) => console.log(message) });
    console.log(`\n请在浏览器填写 Key。若未自动打开，请复制下面的地址：\n${srv.url}\n完成后点「完成，关闭本工具」。排障日志可随时在页面导出。`);
    if (process.env.WB_WEB_URL_FILE) fs.writeFileSync(process.env.WB_WEB_URL_FILE, srv.url, { mode: 0o600 });
    if (process.env.WB_NO_BROWSER !== '1') {
      const opened = openBrowser(srv.url); logger.record('browser.opened', { opened });
    }
    return;
  }
  if (!app.installed && !app.configExists && args.installer) {
    // Explicit installer paths are supported for existing automation. No implicit downloads.
    if (process.platform === 'darwin') installMacDmg(args.installer);
    else if (process.platform === 'win32') installWinExe(args.installer);
    Object.assign(app, detect()); logger.record('workbuddy.install.checked', { installed: app.installed });
  }
  if (!app.installed && !app.configExists) throw Object.assign(new Error('请先安装 WorkBuddy：https://www.workbuddy.cn/'), { code: 'WORKBUDDY_NOT_INSTALLED' });
  if (args.interactive && !key && !platformToken) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    key = (await rl.question('WorkBuddy API Key: ')).trim(); closeAsk();
    logger.addSecret(key); logger.record('key.submitted', { present: !!key }, 'info', operationId);
  }
  const protocol = assertClientProtocol(args.protocol ?? 'auto');
  if (!key && platformToken) {
    const got = await acquireCredentials({ site: base, platformToken, type: args.relayType || 'auto', userId: args.platformUserId, keyName: args.keyName, choose: args.keyId ? async () => args.keyId === 'new' ? 'new' : Number(args.keyId) : undefined });
    key = got.apiKey; base = got.baseUrl; logger.addSecret(key);
  }
  if (!key) throw new Error('请填写 API Key：--key 或 WB_RELAY_KEY');
  let ids = args.models ? args.models.split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (!ids) {
    const found = await discoverModels(base, key, 15000, { logger, operationId });
    if (found.fatal) throw new Error(found.fatal);
    ids = found.ids;
  }
  const effort = args.effort || 'auto';
  if (!EFFORTS.includes(effort)) throw new Error(`思考强度必须为：${EFFORTS.join('/')}`);
  const selected = pickChatModels([...new Set(ids)], Math.max(1, Math.min(500, Number(args.maxModels) || 12)));
  if (!selected.length) throw new Error('没有可导入的模型');
  if (!args.noLaunch && !app.running && process.env.WB_SKIP_DETECT !== '1') logger.record('workbuddy.launched', { launched: launch(app) });
  const result = await runImport({ base, key, protocol, models: selected.map((id) => ({ id, effort })), configPath: args.config, owner: args.owner, prune: !!args.prune, skipProbe: !!args.noProbe || !!args.dryRun, dryRun: !!args.dryRun, vendor: args.vendor, prefix: args.namePrefix, logger, operationId });
  if (!result.ok) throw new Error(result.fatal);
  if (!args.noLaunch && !args.dryRun && process.env.WB_SKIP_DETECT !== '1') focus();
  if (args.json) console.log(JSON.stringify(logger.sanitize(result), null, 2));
  else console.log(`${args.dryRun ? '预览' : '完成'}：新增 ${result.added.length}，更新 ${result.updated.length}，跳过 ${result.skipped.length}。\n操作编号：${operationId}`);
}
main().catch((error) => die(error));
