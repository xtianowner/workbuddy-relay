/** 导入流水线（CLI 与本地网页共用）：读取上游声明 → 探测可用 → 按声明生成配置 → 写 models.json → 等 WorkBuddy 热加载 */
import os from 'node:os';
import crypto from 'node:crypto';
import { VERSION, discoverModels, probe, normalizeProtocol, assertClientProtocol, protocolEndpoint, mapLimit, readConfig, mergeModels, buildEntry, writeConfig, defaultConfigPath, findMergedModel } from './wb-core.mjs';
import { reasoningForImport } from './wb-reasoning.mjs';
import { getLogger } from './wb-logs.mjs';

export const OWNER = 'wb-setup-v1';

/**
 * @param {{base:string,key:string,models:{id:string,effort?:string}[],configPath?:string,owner?:string,skipProbe?:boolean,dryRun?:boolean,fetchImpl?:Function}} o
 * @returns {Promise<{ok:boolean, file:string, rows:object[], written:string[], added:string[], updated:string[], skipped:string[], pruned:string[], merged:boolean|null, fatal?:string}>}
 */
export async function runImport({ base, key, models, protocol = 'auto', configPath, owner = OWNER, prune = false, skipProbe = false, dryRun = false, vendor = 'Custom', prefix = '', fetchImpl = fetch, mergeTimeoutMs = 8000, onProgress = () => {}, logger = getLogger(VERSION), operationId = crypto.randomUUID() }) {
  const file = defaultConfigPath(configPath);
  logger.addSecret(key);
  const started = Date.now();
  const event = (name, details, level = 'info') => logger.record(name, details, level, operationId);
  const reasoningFieldsById = new Map();
  let stage = 'probe';
  event('import.started', { file, models, dryRun, skipProbe });
  try {
  stage = 'protocol.validate';
  const selectedProtocol = assertClientProtocol(protocol);
  models.forEach(model => assertClientProtocol(model.protocol ?? selectedProtocol));
  stage = 'config.read';
  const existing = readConfig(file);
  stage = 'metadata';
  const found = await discoverModels(base, key, 15000, { fetchImpl, logger, operationId });
  if (found.fatal?.startsWith('鉴权失败')) throw Object.assign(new Error(found.fatal), { code: 'MODEL_CATALOG_AUTH_FAILED' });
  const capabilities = found.capabilities || {};
  event('models.capabilities.read', { declared: Object.values(capabilities).filter(value => value.source !== 'unknown').length, available: !found.fatal });
  // Five concurrent model jobs keeps a large catalog moving without
  // overwhelming the relay or triggering its rate limits.
  const rows = await mapLimit(models, 5, async ({ id, effort = 'auto', protocol: modelProtocol }) => {
    const requestedProtocol = normalizeProtocol(modelProtocol ?? selectedProtocol);
    const endpoint = protocolEndpoint(base, 'openai-chat');
    const previous = existing.models.find(m => m.id === id && m.apiKey === key && m.url === endpoint && (!m.wbProtocol || m.wbProtocol === 'openai-chat'));
    const row = { id, effortWanted: effort, effort: 'off', protocolRequested: requestedProtocol, protocol: requestedProtocol === 'auto' ? null : requestedProtocol, usable: true, note: '' };
    let selectedProbe = null;
    if (skipProbe && requestedProtocol === 'auto') {
      if (!previous) throw Object.assign(new Error('跳过检测时无法自动确认协议；请选择 Chat 或先执行检测'), { code: 'PROTOCOL_UNVERIFIED' });
      row.protocol = 'openai-chat';
    }
    onProgress({ ...row, phase: 'availability', status: 'testing' });
    if (!skipProbe) {
      const r = await probe(base, key, id, 30000, { protocol: requestedProtocol, fetchImpl, logger, operationId });
      selectedProbe = r;
      event('model.probed', { id, ok: r.ok, reason: r.reason, fatal: r.fatal }, r.ok ? 'info' : 'warn');
      if (r.fatal) { const failed = { ...row, usable: false, status: 'failed', phase: 'availability', fatal: r.fatal, note: r.fatal }; onProgress(failed); return failed; }
      if (!r.ok) { const failed = { ...row, usable: false, status: 'failed', phase: 'availability', note: `不可用（${r.reason}）` }; onProgress(failed); return failed; }
    }
    onProgress({ ...row, phase: 'reasoning', status: 'testing' });
    // A prior declaration is retained only for the exact endpoint and credential.
    const { extra, rejected, ...reasoning } = reasoningForImport(capabilities[id], effort, previous);
    Object.assign(row, reasoning);
    reasoningFieldsById.set(id, extra);
    if (rejected) row.usable = false;
    if (selectedProbe?.protocol) row.protocol = selectedProbe.protocol;
    event('model.reasoning', { id, requested: effort, selected: row.effort, protocol: row.protocol, source: row.capabilitySource, status: row.capabilityStatus });
    row.phase = 'complete'; row.status = 'completed';
    event('model.completed', row);
    onProgress(row);
    return row;
  });
  const fatal = rows.find((r) => r.fatal);
  if (fatal) { event('import.failed', { stage, code: 'AUTH_FAILED', reason: fatal.fatal }, 'error'); return { ok: false, code: 'AUTH_FAILED', operationId, fatal: fatal.fatal, rows, file }; }
  const good = rows.filter((r) => r.usable);
  if (!good.length) { event('import.failed', { stage, code: 'NO_USABLE_MODELS' }, 'error'); return { ok: false, code: 'NO_USABLE_MODELS', operationId, fatal: '所选模型全部探测失败，未写入配置', rows, file }; }

  const incoming = good.map((r) => buildEntry(r.id, base, key, {
    protocol: r.protocol || protocol, vendor, prefix, owner, extra: reasoningFieldsById.get(r.id),
  }));
  stage = 'config.read'; event('config.read.started', { file });
  const cfg = readConfig(file);
  event('config.read.completed', { file, shape: cfg.shape, count: cfg.models.length });
  const { models: merged, added, updated, skipped, pruned } = mergeModels(cfg.models, incoming, base, owner, prune);
  const written = [...added, ...updated];
  for (const row of rows) {
    row.written = written.includes(row.id);
    if (row.usable && !row.written) row.note = '同名模型已属于其他站点，已跳过；原配置保留';
  }
  event('config.merged', { added, updated, skipped, pruned });
  if (!written.length) { event('import.failed', { code: 'ALL_MODELS_SKIPPED', skipped }, 'warn'); return { ok: false, code: 'ALL_MODELS_SKIPPED', operationId, fatal: '同名模型属于其他站点，未写入配置', rows, file, written, skipped }; }
  const available = cfg.availableModels ? [...new Set([...cfg.availableModels, ...written])] : undefined;
  const out = { ok: true, operationId, file, rows, written, added, updated, skipped, pruned, merged: null };
  if (dryRun) return { ...out, preview: merged };
  stage = 'config.write'; event('config.write.started', { file });
  out.backup = writeConfig(file, cfg, merged, available, { logger, operationId }).backup;
  event('config.write.completed', { file, backup: out.backup, count: written.length });
  stage = 'config.verify';
  const persisted = readConfig(file).models;
  if (!incoming.filter((m) => written.includes(m.id)).every((m) => persisted.some((p) => p.id === m.id && p.url === m.url && p.apiKey === m.apiKey))) throw new Error('配置写入后校验失败，请导出日志排查');
  event('config.verify.completed', { count: written.length });
  stage = 'workbuddy.reload'; event('workbuddy.reload.started', { model: written[0] });
  out.merged = await waitForMerge(written[0], mergeTimeoutMs);
  event('workbuddy.reload.completed', { visible: out.merged }, out.merged === true ? 'info' : 'warn');
  event('import.completed', { written, skipped, durationMs: Date.now() - started });
  return out;
  } catch (error) {
    error.stage = stage;
    error.code ||= stage === 'config.write' ? 'CONFIG_WRITE_FAILED' : stage === 'config.read' ? 'CONFIG_READ_FAILED' : 'IMPORT_FAILED';
    event('import.failed', { stage, error, durationMs: Date.now() - started }, 'error');
    throw error;
  }
}

export async function waitForMerge(modelId, timeoutMs = 8000) {
  const home = os.homedir(); const started = Date.now(); let sawCache = false;
  while (Date.now() - started < timeoutMs) {
    const r = findMergedModel(home, modelId);
    if (r.checked) sawCache = true;
    if (r.found) return true;
    await new Promise((res) => setTimeout(res, 500));
  }
  return sawCache ? false : null;
}
