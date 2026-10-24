#!/usr/bin/env node
/**
 * wb-import —— 只做「导入」的极简 CLI（供前置程序 / 脚本调用）
 * 完整流程（检测安装、唤起、校验）请看 wb-setup.mjs
 *
 *   node wb-import.mjs --url https://relay.example.com --key sk-xxx
 *   node wb-import.mjs --stdin-json < payload.json
 */
import fs from 'node:fs';
import {
  VERSION, normalizeBase, candidates, discoverModels, probe, resolveBaseByProbe, mapLimit,
  readConfig, mergeModels, buildEntry, writeConfig, defaultConfigPath, pickChatModels, maskKey,
} from './lib/wb-core.mjs';

const BOOL = ['dry-run', 'yes', 'no-probe', 'prune', 'stdin-json', 'help', 'version'];
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

const die = (m) => { console.error(`\n✗ ${m}\n`); process.exit(1); };
const log = (m) => console.log(`· ${m}`);

if (args.help || args.h) {
  console.log(`wb-import ${VERSION}
  --url <base> --key <sk>   中转站地址与 Key
  --models a,b,c            手动指定模型
  --config <path>           覆盖 models.json 路径
  --available <mode>        union(默认) | none | replace
  --owner <tag> / --prune   只清理自己写入过的条目
  --no-probe                跳过探测
  --stdin-json              从 stdin 读 {"url","key","models"}
  --dry-run                 不落盘`);
  process.exit(0);
}

async function main() {
  let url = args.url || process.env.WB_RELAY_URL;
  let key = args.key || process.env.WB_RELAY_KEY;
  let modelsArg = args.models;

  if (args.stdinJson) {
    const j = JSON.parse(fs.readFileSync(0, 'utf8'));
    url = url || j.url || j.baseUrl || j.base_url;
    key = key || j.key || j.apiKey || j.api_key;
    if (!modelsArg && Array.isArray(j.models)) modelsArg = j.models.join(',');
  }
  if (!url) die('缺少 --url');
  if (!key) die('缺少 --key');

  const base0 = normalizeBase(url);
  if (!base0) die('--url 不合法');
  const file = defaultConfigPath(args.config);

  let base = base0;
  let ids = [];
  if (modelsArg) {
    ids = modelsArg.split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) die('--models 为空');
    if (!args.noProbe && !args.dryRun) {
      const r = await resolveBaseByProbe(base0, key, ids[0]);
      if (r.fatal) die(`${r.fatal}：Key 无效或无权限`);
      if (r.error) die(`接口地址不通：\n  ${r.error}`);
      base = r.base;
    } else base = candidates(base0).slice(-1)[0];
  } else {
    log(`发现模型：${candidates(base0).map((b) => `${b}/models`).join(' 或 ')} …`);
    const found = await discoverModels(base0, key);
    if (found.fatal) die(`${found.fatal}${found.tried ? `\n已尝试：${found.tried.join(', ')}` : ''}\n（可用 --models a,b,c 手动指定）`);
    base = found.base;
    ids = found.ids;
    log(`发现 ${ids.length} 个模型（base = ${base}）`);
  }

  let picked = pickChatModels(ids, Number(args.maxModels || 12));
  if (!picked.length) die('没有可用模型 id');

  if (!args.noProbe && !args.dryRun && !modelsArg) {
    log(`连通性探测 ${picked.length} 个模型…`);
    const rows = await mapLimit(picked, 4, async (m) => ({ m, r: await probe(base, key, m) }));
    const fatal = rows.find((x) => x.r.fatal);
    if (fatal) die(`${fatal.r.fatal}：${fatal.r.body || ''}`);
    const bad = rows.filter((x) => !x.r.ok);
    if (bad.length) log(`跳过不可用：${bad.map((b) => `${b.m}(${b.r.reason})`).join(', ')}`);
    const good = rows.filter((x) => x.r.ok).map((x) => x.m);
    if (!good.length) die('全部模型探测失败，未写入配置');
    picked = good;
  }

  const owner = args.owner === undefined ? 'wb-import-v1' : args.owner;
  const incoming = picked.map((id) => buildEntry(id, base, key, {
    vendor: args.vendor || 'Custom', prefix: args.namePrefix || '', owner,
  }));

  const cfg = readConfig(file);
  const { models, added, updated, skipped, pruned } = mergeModels(cfg.models, incoming, base, owner, !!args.prune);
  const available = cfg.availableModels ? [...new Set([...cfg.availableModels, ...picked])] : undefined;

  console.log('');
  console.log(`配置文件  ${file}`);
  console.log(`接口      ${base}/chat/completions`);
  console.log(`API Key   ${maskKey(key)}`);
  console.log(`新增 ${added.length} / 更新 ${updated.length} / 跳过 ${skipped.length}${pruned.length ? ` / 清理 ${pruned.length}` : ''}`);
  if (added.length) console.log(`  新增：${added.join(', ')}`);
  if (updated.length) console.log(`  更新：${updated.join(', ')}`);
  if (pruned.length) console.log(`  清理：${pruned.join(', ')}`);
  skipped.forEach((s) => console.log(`  ${s}`));
  console.log('');

  if (args.dryRun) { console.log(JSON.stringify(models, null, 2)); log('dry-run，未写入'); return; }

  writeConfig(file, cfg, models, available);
  log('已写入，WorkBuddy 约 1 秒内热加载，无需重启。');
}

main().catch((e) => die(e.stack || e.message));
