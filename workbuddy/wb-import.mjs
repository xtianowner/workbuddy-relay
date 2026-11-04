#!/usr/bin/env node
/**
 * wb-import —— 只做「导入」的极简 CLI（供前置程序 / 脚本调用）
 * 完整流程（检测安装、唤起、校验）请看 wb-setup.mjs
 *
 *   node wb-import.mjs --url https://relay.example.com --key sk-xxx
 *   node wb-import.mjs --stdin-json < payload.json
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PLATFORM_BASE } from './lib/wb-brand.mjs';
import { getLogger } from './lib/wb-logs.mjs';
import { VERSION, PROTOCOLS, assertClientProtocol, normalizeBase, discoverModels, pickChatModels, maskKey, defaultConfigPath } from './lib/wb-core.mjs';
import { runImport } from './lib/wb-flow.mjs';
import { EFFORTS } from './lib/wb-reasoning.mjs';

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

const logger = getLogger(VERSION), operationId = crypto.randomUUID();
const die = (m) => { logger.record('import.failed', { message: m }, 'error', operationId); console.error(`\n✗ ${logger.sanitize(m)}\n操作编号：${operationId}\n`); process.exit(1); };
const log = (m) => { logger.record('cli.progress', { message: m }, 'info', operationId); console.log(`· ${m}`); };

if (args.help || args.h) {
  console.log(`wb-import ${VERSION}
  --key <sk>               SmarAgents API Key（默认固定平台）
  --url <base>             开源开发接口：覆盖平台地址
  --models a,b,c            手动指定模型
  --config <path>           覆盖 models.json 路径
  --available <mode>        union(默认) | none | replace
  --owner <tag> / --prune   只清理自己写入过的条目
  --no-probe                跳过生成连通性探测，仍读取上游声明
  --protocol <protocol>     ${PROTOCOLS.join(' | ')}
  --stdin-json              从 stdin 读 {"url","key","models"}
  --dry-run                 不落盘`);
  process.exit(0);
}

async function main() {
  let url = args.url || process.env.WB_RELAY_URL;
  let key = args.key || process.env.WB_RELAY_KEY;
  let modelsArg = args.models;
  let protocolArg = args.protocol;

  if (args.stdinJson) {
    const j = JSON.parse(fs.readFileSync(0, 'utf8'));
    url = url || j.url || j.baseUrl || j.base_url;
    key = key || j.key || j.apiKey || j.api_key;
    protocolArg ??= j.protocol;
    if (!modelsArg && Array.isArray(j.models)) modelsArg = j.models.join(',');
  }
  url ||= PLATFORM_BASE;
  if (!key) die('缺少 --key');
  logger.addSecret(key);

  const base0 = normalizeBase(url);
  if (!base0) die('--url 不合法');
  const file = defaultConfigPath(args.config);

  const protocol = assertClientProtocol(protocolArg ?? 'auto');
  const base = base0;
  let ids = modelsArg ? modelsArg.split(',').map(s => s.trim()).filter(Boolean) : null;
  if (!ids) {
    const found = await discoverModels(base, key, 15000, { logger, operationId });
    if (found.fatal) die(found.fatal);
    ids = found.ids;
  }
  const picked = pickChatModels(ids, Number(args.maxModels || 12));
  if (!picked.length) die('没有可用模型 id');
  const effort = args.effort || 'auto';
  if (!EFFORTS.includes(effort)) die(`思考强度必须为：${EFFORTS.join('/')}`);
  const result = await runImport({
    base, key, protocol, models: picked.map(id => ({ id, effort })), configPath: file,
    owner: args.owner === undefined ? 'wb-import-v1' : args.owner, prune: !!args.prune,
    skipProbe: !!args.noProbe || !!args.dryRun, dryRun: !!args.dryRun,
    vendor: args.vendor || 'Custom', prefix: args.namePrefix || '', logger, operationId, mergeTimeoutMs: 0,
  });
  if (!result.ok) die(result.fatal);
  console.log(`配置文件  ${file}`);
  console.log(`接口      ${base}/chat/completions`);
  console.log(`API Key   ${maskKey(key)}`);
  console.log(`新增 ${result.added.length} / 更新 ${result.updated.length} / 跳过 ${result.skipped.length}`);
  if (args.dryRun) { console.log(JSON.stringify(logger.sanitize(result.preview), null, 2)); log('dry-run，未写入'); }
  else log('已写入，WorkBuddy 约 1 秒内热加载，无需重启。');

}

main().catch((e) => die(e.stack || e.message));
