/** 导入流水线（CLI 与本地网页共用）：探测可用 → 思考强度探测/降级 → 写 models.json → 等 WorkBuddy 热加载 */
import os from 'node:os';
import crypto from 'node:crypto';
import { VERSION, probe, mapLimit, readConfig, mergeModels, buildEntry, writeConfig, defaultConfigPath, findMergedModel } from './wb-core.mjs';
import { probeReasoning, reasoningFields, probeLevels, nearestLevel, EFFORT_LABEL, WB_LEVELS } from './wb-reasoning.mjs';
import { getLogger, loggedFetch } from './wb-logs.mjs';

export const OWNER = 'wb-setup-v1';

/**
 * @param {{base:string,key:string,models:{id:string,effort?:string}[],configPath?:string,owner?:string,skipProbe?:boolean,dryRun?:boolean,fetchImpl?:Function}} o
 * @returns {Promise<{ok:boolean, file:string, rows:object[], written:string[], added:string[], updated:string[], skipped:string[], pruned:string[], merged:boolean|null, fatal?:string}>}
 */
export async function runImport({ base, key, models, configPath, owner = OWNER, prune = false, skipProbe = false, dryRun = false, vendor = 'Custom', prefix = '', fetchImpl = fetch, mergeTimeoutMs = 8000, onProgress = () => {}, logger = getLogger(VERSION), operationId = crypto.randomUUID() }) {
  const file = defaultConfigPath(configPath);
  logger.addSecret(key);
  const started = Date.now();
  const event = (name, details, level = 'info') => logger.record(name, details, level, operationId);
  const request = loggedFetch(fetchImpl, logger, operationId);
  let stage = 'probe';
  event('import.started', { file, models, dryRun, skipProbe });
  try {
  // Five concurrent model jobs keeps a large catalog moving without
  // overwhelming the relay or triggering its rate limits.
  const rows = await mapLimit(models, 5, async ({ id, effort = 'auto' }) => {
    const row = { id, effortWanted: effort, effort: 'off', usable: true, note: '' };
    onProgress({ ...row, phase: 'availability', status: 'testing' });
    if (!skipProbe) {
      const r = await probe(base, key, id, 30000, { fetchImpl, logger, operationId });
      event('model.probed', { id, ok: r.ok, reason: r.reason, fatal: r.fatal }, r.ok ? 'info' : 'warn');
      if (r.fatal) { const failed = { ...row, usable: false, status: 'failed', phase: 'availability', fatal: r.fatal, note: r.fatal }; onProgress(failed); return failed; }
      if (!r.ok) { const failed = { ...row, usable: false, status: 'failed', phase: 'availability', note: `不可用（${r.reason}）` }; onProgress(failed); return failed; }
    }
    if (effort !== 'off') {
      onProgress({ ...row, phase: 'reasoning', status: 'testing' });
      const want = effort === 'auto' ? 'medium' : effort; // 自动：所有模型都实测，通过就默认「中」
      if (skipProbe) { if (effort !== 'auto') { row.effort = effort; row.format = 'openai'; row.note = '未探测思考强度'; } }
      else {
        // 先查这个模型支持哪些档位（只对 OpenAI 格式有意义），再用落到支持范围内的档位做正式探测
        const lv = await probeLevels(base, key, id, { fetchImpl: request, timeoutMs: 60000 });
        const candidates = lv.levels ? WB_LEVELS.filter(v => lv.levels.includes(v) || lv.unknown?.includes(v)) : null;
        const use = candidates ? nearestLevel(want, candidates) : want;
        const t = await probeReasoning(base, key, id, use, { fetchImpl: request, timeoutMs: 60000 });
        event('model.reasoning', { id, requested: effort, selected: use, levels: lv.levels, how: lv.how, supported: t.ok, format: t.format, reason: t.reason });
        if (!t.ok && t.uncertain) {
          const previous = readConfig(file).models.find(m => m.id === id && m.url === `${base}/chat/completions`);
          row.effort = previous?.reasoning?.defaultEffort || use;
          row.format = previous?.compat?.thinkingFormat || 'openai';
          row.levels = previous?.reasoning?.supportedEfforts || candidates || undefined;
          row.canDisable = previous?.reasoning?.canDisableThinking;
          row.note = `思考参数暂未确认（${t.reason}）；保留思考配置，未判定为不支持`;
        }
        else if (effort === 'auto' && !t.ok) row.note = `服务明确拒绝思考参数（${t.reason}），已关闭`;
        else if (t.ok) {
          row.effort = use; row.format = t.format; row.confirmed = t.confirmed;
          if (t.format === 'openai' && candidates) { row.levels = candidates; row.canDisable = lv.canDisable; }
          const lvTxt = row.levels ? `可选：${row.levels.map((v) => EFFORT_LABEL[v]).join('/')}${lv.how === 'partial' ? '（含待确认档位；服务异常未按不支持处理）' : '（参数请求通过）'}` : '档位可调性未确认，暂按低/中/高配置';
          const moved = use !== want ? `「${EFFORT_LABEL[want]}」不支持，已改为「${EFFORT_LABEL[use]}」；` : '';
          row.note = `${moved}${lvTxt}；${t.confirmed ? '已返回思考信息；无法据此确认各档位效果' : '参数请求通过；未返回思考信息，实际效果未确认'}`;
        }
        else row.note = `该模型经此服务不支持思考强度（${t.reason}），已按不带思考强度导入`;
      }
    }
    row.phase = 'complete'; row.status = 'completed';
    event('model.completed', row);
    onProgress(row);
    return row;
  });
  const fatal = rows.find((r) => r.fatal);
  if (fatal) { event('import.failed', { stage, code: 'AUTH_FAILED', reason: fatal.fatal }, 'error'); return { ok: false, code: 'AUTH_FAILED', operationId, fatal: fatal.fatal, rows, file }; }
  const good = rows.filter((r) => r.usable);
  if (!good.length) { event('import.failed', { stage, code: 'NO_USABLE_MODELS' }, 'error'); return { ok: false, code: 'NO_USABLE_MODELS', operationId, fatal: '所选模型全部探测失败，未写入配置', rows, file }; }

  const incoming = good.map((r) => {
    const rf = reasoningFields(r.effort, r.format, r.levels, r.canDisable);
    const extra = r.effort === 'off' ? { ...rf, reasoning: undefined, compat: undefined } : { ...rf, compat: rf.compat };
    return buildEntry(r.id, base, key, { vendor, prefix, owner, extra });
  });
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
