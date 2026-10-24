#!/usr/bin/env node
/**
 * wb-setup —— 中转站一键接入 WorkBuddy（macOS / Windows 通用）
 *
 *   node wb-setup.mjs --url https://relay.example.com --key sk-xxx
 *
 * 做五件事：检测 → 连接 → 探测 → 写入 → 唤起并校验
 *
 * 为什么不需要用户先装 Node：WorkBuddy 本身是 Electron 应用，
 * 用 `ELECTRON_RUN_AS_NODE=1 <WorkBuddy 可执行文件>` 就能当 Node 22 用（见 bootstrap/ 里的两个引导脚本）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  VERSION, normalizeBase, candidates, discoverModels, probe, resolveBaseByProbe, mapLimit,
  readConfig, mergeModels, buildEntry, writeConfig, defaultConfigPath, pickChatModels,
  findMergedModel, maskKey, hostOf,
} from './lib/wb-core.mjs';
import readline from 'node:readline/promises';
import { acquireCredentials, isInsecure, detectRelay, siteOrigin } from './lib/wb-relay.mjs';

let rl = null;
const ask = async (q) => { rl ||= readline.createInterface({ input: process.stdin, output: process.stdout }); return (await rl.question(q)).trim(); };
const closeAsk = () => { if (rl) { rl.close(); rl = null; } };

async function askSite() {
  console.log(`\n${C.b('第 1 步 · 中转站地址')}`);
  console.log(C.dim('      就是你在浏览器里打开中转站的地址，例如 https://api.example.com'));
  for (;;) { const v = await ask('      站点地址: '); if (siteOrigin(v)) return v; warn('地址看起来不对，请重新输入'); }
}

async function wizardKey(site) {
  const det = await detectRelay(site);
  const name = { newapi: 'new-api', sub2api: 'sub2api' }[det.type];
  ok(name ? `识别为 ${name} 平台：${det.origin}` : `未能识别平台类型（${det.origin}），可以直接粘贴 Key`);
  if (isInsecure(det.origin)) warn('站点是 http 明文传输，Key 可能被窃听');
  console.log(`\n${C.b('第 2 步 · 怎么获取 Key')}`);
  console.log(`        1) 用平台令牌自动获取（列出你已有的 Key，可选或新建）`);
  console.log(`        2) 我已经复制好 Key，直接粘贴`);
  const mode = (await ask('      选择 [1]: ')) || '1';
  if (mode === '1') {
    if (det.type === 'sub2api' || det.type === 'unknown') console.log(C.dim('      sub2api：登录网页后在浏览器开发者工具 → Application → Local Storage 里复制 auth_token（较麻烦，推荐直接粘贴 Key）'));
    if (det.type === 'newapi' || det.type === 'unknown') console.log(C.dim('      new-api：个人设置 → 访问令牌 → 新建，勾选 api_key:read / api_key:reveal / api_key:write，复制 nap_ 开头的令牌'));
    const token = await ask('      平台令牌: ');
    try {
      const got = await acquireCredentials({ site, platformToken: token, type: det.type === 'unknown' ? 'auto' : det.type, choose: chooseKey });
      ok(`已取得 Key「${got.keyName}」：${maskKey(got.apiKey)}`);
      return { url: got.baseUrl, key: got.apiKey };
    } catch (e) { warn(`自动获取失败：${e.message}`); warn('改为手动粘贴'); }
  }
  console.log(C.dim('      在平台的「令牌 / API 密钥」页点复制，粘贴到这里'));
  for (;;) { const k = await ask('      API Key: '); if (k) return { url: site, key: k }; }
}

async function chooseKey(keys) {
  console.log(`\n${C.b('第 3 步 · 选择 Key')}`);
  if (!keys.length) { ok('账号下还没有可用 Key，将新建一个名为 WorkBuddy 的 Key'); return 'new'; }
  keys.forEach((k, i) => console.log(`        ${i + 1}) ${k.name}  ${C.dim(k.masked || '')}`));
  console.log('        n) 新建一个 WorkBuddy 专用 Key');
  const ans = (await ask('      选择 [1]: ')).toLowerCase();
  if (ans === 'n') return 'new';
  return keys[(Number(ans) || 1) - 1]?.id ?? keys[0].id;
}
import { suggestEffort, probeReasoning, reasoningFields, EFFORTS, EFFORT_LABEL } from './lib/wb-reasoning.mjs';
import { startWebServer } from './lib/wb-web.mjs';
import { detect, launch, focus, openBrowser, installMacDmg, installWinExe } from './lib/wb-platform.mjs';

const BOOL = ['web', 'interactive', 'dry-run', 'yes', 'no-probe', 'no-launch', 'json', 'help', 'version', 'install'];
const args = (() => {
  const out = { _: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (BOOL.includes(a.slice(2))) out[k] = true;
    else out[k] = argv[++i];
  }
  return out;
})();

const C = process.stdout.isTTY
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, ok: (s) => `\x1b[32m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, err: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` }
  : { dim: (s) => s, ok: (s) => s, warn: (s) => s, err: (s) => s, b: (s) => s };

const step = (n, t) => console.log(`\n${C.b(`[${n}/5]`)} ${t}`);
// 中文按 2 列宽计算，保证冒号对齐
const w = (s) => [...s].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
const info = (k, v) => console.log(`      ${C.dim(k + ' '.repeat(Math.max(1, 12 - w(k))))} ${v}`);
const ok = (s) => console.log(`      ${C.ok('✓')} ${s}`);
const warn = (s) => console.log(`      ${C.warn('!')} ${s}`);
const fail = (s) => console.log(`      ${C.err('✗')} ${s}`);

if (args.help) {
  console.log(`wb-setup ${VERSION} —— 把中转站一键接进 WorkBuddy

  --url <base>          中转站地址，https://host 或 https://host/v1 都行
  --key <sk-...>        API Key
  --platform-token <t>  平台凭证：new-api 个人访问令牌 nap_… / sub2api 登录 access_token
  --relay-type <t>      auto(默认) | newapi | sub2api
  --key-name <s>        新建 Key 的名称（默认 WorkBuddy）
  --platform-user-id <n> new-api 用户 ID（New-Api-User 头，默认自动获取）
  --key-id <id|new>     直接指定用哪个 Key，或 new 新建（不指定则交互选择）
  （不带参数双击/运行时：打开本地网页填写，推荐普通用户使用）
  --web                 强制打开本地网页模式
  --interactive         终端里的问答式引导（开发者用）
  --effort <e>          思考强度：auto(默认，逐个实测，支持就开「中」) | off | low | medium | high
  --models a,b,c        指定模型，跳过自动发现
  --vendor <name>       供应商显示名（默认 Custom）
  --name-prefix <s>     模型名前缀，便于在列表里认出是谁
  --max-models <n>      最多导入几个（默认 12）
  --config <path>       覆盖 models.json 路径
  --installer <path|url> 未安装时用它自动安装（.dmg / .exe）
  --download-page <url> 未安装且没有 installer 时打开的页面
  --no-probe            跳过逐个模型探测（快，但可能导入用不了的模型）
  --no-launch           导入后不唤起 WorkBuddy
  --dry-run             只演练，不写盘
  --json                以 JSON 输出结果（给上层程序用）
`);
  process.exit(0);
}
if (args.version) { console.log(VERSION); process.exit(0); }

const result = { platform: process.platform, ok: false, steps: {}, models: [], errors: [] };
const die = (msg, code = 1) => {
  closeAsk();
  fail(msg);
  result.errors.push(msg);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  process.exit(code);
};

async function main() {
  let url = args.url || process.env.WB_RELAY_URL;
  let key = args.key || process.env.WB_RELAY_KEY;
  /* ---------- 1. 检测 ---------- */
  step(1, '检测 WorkBuddy 安装情况');
  let app = process.env.WB_SKIP_DETECT === '1' ? { platform: process.platform, supported: true, installed: true, appPath: '(测试模式跳过检测)', version: null, running: true } : detect();
  info('系统', `${app.platform}${app.supported ? '' : '（暂不支持）'}`);
  info('安装路径', app.appPath || C.warn('未找到'));
  info('版本', app.version || '—');
  info('运行中', app.running ? '是' : '否');
  info('配置文件', defaultConfigPath(args.config));
  result.steps.detect = { installed: app.installed, version: app.version, running: app.running, path: app.appPath };

  if (!app.installed) {
    const page = args.downloadPage || 'https://www.workbuddy.cn/';
    if (args.installer) {
      warn('未安装，尝试用指定的安装包自动安装…');
      const file = await fetchInstaller(args.installer);
      if (!file) die('安装包下载失败');
      if (app.platform === 'darwin' && file.endsWith('.dmg')) installMacDmg(file);
      else if (app.platform === 'win32') installWinExe(file);
      else die('不支持的安装包类型');
      app = detect();
      if (!app.installed) die('自动安装未成功，请手动安装后重试');
      ok(`已安装 ${app.appPath}（${app.version || '版本未知'}）`);
    } else {
      warn('没有检测到 WorkBuddy，已为你打开下载页');
      openBrowser(page);
      console.log(`\n  请先安装 WorkBuddy：${page}`);
      console.log('  装完重新运行本命令即可（也可以加 --installer <dmg/exe 路径> 让它自动装）。\n');
      die('未安装 WorkBuddy', 2);
    }
  } else {
    ok(`已安装 ${app.version ? `v${app.version}` : ''}${app.running ? '，正在运行（热加载生效，无需重启）' : ''}`);
  }

  /* ---------- 本地网页模式（双击启动时默认进入） ---------- */
  if (args.web || (!url && !key && !args.interactive && !args.json && !args.platformToken && !process.env.WB_PLATFORM_TOKEN)) {
    if (!args.noLaunch && !app.running && process.env.WB_SKIP_DETECT !== '1') { try { launch(app); } catch { /* 打不开也不影响导入 */ } }
    const srv = await startWebServer({ app, configPath: args.config, log: (m) => console.log(`      ${m}`) });
    console.log(`\n${C.b('已在浏览器中打开导入页面')}，请在网页里完成填写。`);
    console.log(C.dim(`      如果浏览器没有自动打开，请复制这个地址到浏览器：\n      ${srv.url}`));
    console.log(C.dim('      导入完成后点网页上的「完成，关闭本工具」，本窗口会自动关闭。'));
    if (process.env.WB_WEB_URL_FILE) fs.writeFileSync(process.env.WB_WEB_URL_FILE, srv.url, { mode: 0o600 }); // 仅供自动化测试
    if (process.env.WB_NO_BROWSER !== '1') openBrowser(srv.url);
    return;
  }

  /* ---------- 终端交互式引导（--interactive） ---------- */
  const interactive = !!args.interactive;
  if (interactive && !url) url = await askSite();
  if (interactive && url && !key && !args.platformToken && !process.env.WB_PLATFORM_TOKEN) ({ url, key } = await wizardKey(url));
  // v2：没有 sk-key 时，用平台现有凭证（new-api 个人访问令牌 nap_… / sub2api 登录 token）列出或新建 Key
  const platformToken = args.platformToken || process.env.WB_PLATFORM_TOKEN;
  if (!key && url && platformToken) {
    try {
      const got = await acquireCredentials({
        site: url, platformToken, type: args.relayType || 'auto', userId: args.platformUserId, keyName: args.keyName,
        choose: args.keyId ? async () => (args.keyId === 'new' ? 'new' : Number(args.keyId)) : (interactive ? chooseKey : undefined),
      });
      url = got.baseUrl; key = got.apiKey;
      console.log(`      ✓ 已从 ${got.relayType} 取得 Key「${got.keyName}」：${maskKey(key)}`);
      if (isInsecure(url)) warn('站点是 http 明文传输，Key 可能被窃听');
    } catch (e) { die(`自动获取 Key 失败：${e.message}；也可以在平台网页复制后用 --url --key 手动导入`); }
  }

  closeAsk();
  if (!url) die('缺少 --url');
  if (!key) die('缺少 --key');

  /* ---------- 2. 连接并发现模型 ---------- */
  step(2, '连接中转站');
  const base0 = normalizeBase(url);
  if (!base0) die(`--url 不合法：${url}`);
  info('站点', hostOf(base0) || base0);
  info('API Key', maskKey(key));

  let base = base0;
  let ids = [];
  const manual = args.models ? args.models.split(',').map((s) => s.trim()).filter(Boolean) : null;

  if (manual) {
    ids = manual;
    if (!args.noProbe && !args.dryRun) {
      const r = await resolveBaseByProbe(base0, key, ids[0]);
      if (r.fatal) die(`${r.fatal}（Key 无效或无权限）`);
      if (r.error) die(`接口地址不通，两种写法都试过：\n  ${r.error}`);
      base = r.base;
    } else {
      base = candidates(base0).slice(-1)[0];
    }
    ok(`使用指定模型 ${ids.length} 个，接口 ${base}`);
  } else {
    const found = await discoverModels(base0, key);
    if (found.fatal) die(`${found.fatal}\n  已尝试：${found.tried.join('\n           ')}\n  可用 --models a,b,c 手动指定`);
    base = found.base;
    ids = found.ids;
    ok(`发现 ${ids.length} 个模型，接口 ${base}`);
    if (base !== base0) info('校正', `自动补成 ${base}`);
  }
  result.steps.connect = { base, discovered: ids.length };

  /* ---------- 3. 探测 ---------- */
  step(3, '验证模型可用性');
  let picked = pickChatModels(ids, Number(args.maxModels || 12));
  if (!picked.length) die('没有可导入的模型');
  info('候选', picked.join(', '));

  if (args.noProbe || args.dryRun || manual) {
    warn(args.dryRun ? 'dry-run，跳过探测' : '已跳过探测，导入的模型未必都能用');
  } else {
    const rows = await mapLimit(picked, 4, async (m) => ({ m, r: await probe(base, key, m) }));
    const fatal = rows.find((x) => x.r.fatal);
    if (fatal) die(`${fatal.r.fatal}：${fatal.r.body || ''}`);
    const good = rows.filter((x) => x.r.ok).map((x) => x.m);
    const bad = rows.filter((x) => !x.r.ok);
    if (bad.length) bad.forEach((b) => warn(`${b.m} 不可用（${b.r.reason}）${b.r.body ? ` ${b.r.body.slice(0, 80)}` : ''}`));
    if (!good.length) die(`全部模型探测失败，未写入配置`);
    ok(`可用 ${good.length} / ${picked.length}`);
    picked = good;
  }
  // 思考强度：按 --effort 或模型家族建议；探测不通过就降级为不带思考强度
  const effortArg = (args.effort || 'auto').toLowerCase();
  if (!EFFORTS.includes(effortArg)) die(`--effort 只能是 ${EFFORTS.join('/')}`);
  const reasoning = {};
  await mapLimit(picked, 4, async (m) => {
    const e = effortArg === 'auto' ? 'medium' : effortArg; // auto：每个模型都实测
    if (e === 'off') { reasoning[m] = { effort: 'off' }; return; }
    if (args.noProbe || args.dryRun) { reasoning[m] = effortArg === 'auto' ? { effort: suggestEffort(m), format: 'openai' } : { effort: e, format: 'openai' }; return; }
    const t = await probeReasoning(base, key, m, e);
    if (t.ok) reasoning[m] = { effort: e, format: t.format };
    else { reasoning[m] = { effort: 'off' }; warn(`${m} 经此中转站不支持思考强度（${t.reason}），按不带思考强度导入`); }
  });
  info('思考强度', picked.map((m) => `${m}=${EFFORT_LABEL[reasoning[m].effort]}`).join(', '));
  result.models = picked;
  result.steps.probe = { picked, reasoning };

  /* ---------- 4. 写入 ---------- */
  step(4, '写入 WorkBuddy 配置');
  const file = defaultConfigPath(args.config);
  const vendor = args.vendor || 'Custom';
  const prefix = args.namePrefix || '';
  const owner = args.owner === undefined ? 'wb-setup-v1' : args.owner;
  const incoming = picked.map((id) => {
    const r = reasoning[id]; const rf = reasoningFields(r.effort, r.format);
    return buildEntry(id, base, key, { vendor, prefix, owner, extra: r.effort === 'off' ? { ...rf, reasoning: undefined, compat: undefined } : { ...rf, compat: rf.compat } });
  });

  const cfg = readConfig(file);
  const { models, added, updated, skipped, pruned } = mergeModels(cfg.models, incoming, base, owner, !!args.prune);
  const available = cfg.availableModels ? [...new Set([...cfg.availableModels, ...picked])] : undefined;

  info('写入', file);
  info('结果', `新增 ${added.length} · 更新 ${updated.length} · 跳过 ${skipped.length}${pruned.length ? ` · 清理 ${pruned.length}` : ''}`);
  skipped.forEach((s) => warn(s));
  result.steps.write = { file, added, updated, skipped, pruned };

  if (args.dryRun) {
    console.log(`\n${JSON.stringify(models, null, 2)}`);
    warn('dry-run，未写入');
    result.ok = true;
    if (args.json) console.log(JSON.stringify(result, null, 2));
    return;
  }
  writeConfig(file, cfg, models, available);
  ok('已写盘（权限 600）');

  /* ---------- 5. 唤起并校验 ---------- */
  step(5, '唤起 WorkBuddy 并校验');
  if (!args.noLaunch) {
    if (!app.running) { launch(app); info('启动', '已拉起 WorkBuddy'); }
    focus();
  } else warn('按要求不唤起');

  const merged = await waitForMerge(picked[0]);
  if (merged === true) {
    ok('WorkBuddy 已接收配置（约 1 秒热加载完成，无需重启）');
  } else if (merged === false) {
    warn('暂未在校验缓存里看到新模型：可能 WorkBuddy 还没启动完成');
    warn('稍等几秒后打开模型选择器，Custom 分组里应能看到');
  } else {
    warn('未找到应用侧缓存（WorkBuddy 可能从未启动过），配置已就绪，下次启动即生效');
  }

  result.ok = true;
  result.steps.verify = { merged };
  console.log(`\n${C.ok('完成')} · 共 ${picked.length} 个模型可用：${picked.join(', ')}`);
  console.log(C.dim(`  在 WorkBuddy 输入框上方的模型选择器里，往下翻到「自定义 / Custom」分组。\n`));
  if (args.json) console.log(JSON.stringify(result, null, 2));
}

/** 轮询应用合并后的配置缓存，确认真的吃进去了 */
async function waitForMerge(modelId, timeoutMs = 8000) {
  const home = os.homedir();
  const started = Date.now();
  let sawCache = false;
  while (Date.now() - started < timeoutMs) {
    const r = findMergedModel(home, modelId);
    if (r.checked) sawCache = true;
    if (r.found) return true;
    await new Promise((res) => setTimeout(res, 500));
  }
  return sawCache ? false : null;
}

async function fetchInstaller(src) {
  if (fs.existsSync(src)) return src;
  if (!/^https?:\/\//i.test(src)) return null;
  const out = path.join(os.tmpdir(), path.basename(new URL(src).pathname) || 'workbuddy-installer');
  console.log(`      下载安装包 → ${out}`);
  const res = await fetch(src);
  if (!res.ok) return null;
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

main().catch((e) => die(e.stack || e.message));
