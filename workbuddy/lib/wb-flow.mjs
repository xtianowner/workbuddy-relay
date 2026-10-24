/** 导入流水线（CLI 与本地网页共用）：探测可用 → 思考强度探测/降级 → 写 models.json → 等 WorkBuddy 热加载 */
import os from 'node:os';
import { probe, mapLimit, readConfig, mergeModels, buildEntry, writeConfig, defaultConfigPath, findMergedModel } from './wb-core.mjs';
import { probeReasoning, reasoningFields, probeLevels, nearestLevel, EFFORT_LABEL } from './wb-reasoning.mjs';

export const OWNER = 'wb-setup-v1';

/**
 * @param {{base:string,key:string,models:{id:string,effort?:string}[],configPath?:string,owner?:string,skipProbe?:boolean,dryRun?:boolean,fetchImpl?:Function}} o
 * @returns {Promise<{ok:boolean, file:string, rows:object[], written:string[], added:string[], updated:string[], skipped:string[], pruned:string[], merged:boolean|null, fatal?:string}>}
 */
export async function runImport({ base, key, models, configPath, owner = OWNER, skipProbe = false, dryRun = false, vendor = 'Custom', prefix = '', fetchImpl = fetch, mergeTimeoutMs = 8000, onProgress = () => {} }) {
  const file = defaultConfigPath(configPath);
  const rows = await mapLimit(models, 4, async ({ id, effort = 'auto' }) => {
    const row = { id, effortWanted: effort, effort: 'off', usable: true, note: '' };
    if (!skipProbe) {
      const r = await probe(base, key, id);
      if (r.fatal) return { ...row, usable: false, fatal: r.fatal, note: r.fatal };
      if (!r.ok) { onProgress(row); return { ...row, usable: false, note: `不可用（${r.reason}）` }; }
    }
    if (effort !== 'off') {
      const want = effort === 'auto' ? 'medium' : effort; // 自动：所有模型都实测，通过就默认「中」
      if (skipProbe) { if (effort !== 'auto') { row.effort = effort; row.format = 'openai'; row.note = '未探测思考强度'; } }
      else {
        // 先查这个模型支持哪些档位（只对 OpenAI 格式有意义），再用落到支持范围内的档位做正式探测
        const lv = await probeLevels(base, key, id, { fetchImpl });
        const use = lv.levels ? nearestLevel(want, lv.levels) : want;
        const t = await probeReasoning(base, key, id, use, { fetchImpl });
        if (effort === 'auto' && !t.ok) row.note = `实测不支持思考强度（${t.reason}），已关闭`;
        else if (t.ok) {
          row.effort = use; row.format = t.format; row.confirmed = t.confirmed;
          if (t.format === 'openai' && lv.levels) { row.levels = lv.levels; row.canDisable = lv.canDisable; }
          const lvTxt = row.levels ? `可选：${row.levels.map((v) => EFFORT_LABEL[v]).join('/')}` : '档位未能实测，按低/中/高写入';
          const moved = use !== want ? `「${EFFORT_LABEL[want]}」不支持，已改为「${EFFORT_LABEL[use]}」；` : '';
          row.note = `${moved}${lvTxt}；${t.confirmed ? '思考强度已生效' : '中转站已接受思考参数（未返回思考内容，无法确认是否生效）'}`;
        }
        else row.note = `该模型经此中转站不支持思考强度（${t.reason}），已按不带思考强度导入`;
      }
    }
    onProgress(row);
    return row;
  });
  const fatal = rows.find((r) => r.fatal);
  if (fatal) return { ok: false, fatal: fatal.fatal, rows, file };
  const good = rows.filter((r) => r.usable);
  if (!good.length) return { ok: false, fatal: '所选模型全部探测失败，未写入配置', rows, file };

  const incoming = good.map((r) => {
    const rf = reasoningFields(r.effort, r.format, r.levels, r.canDisable);
    const extra = r.effort === 'off' ? { ...rf, reasoning: undefined, compat: undefined } : { ...rf, compat: rf.compat };
    return buildEntry(r.id, base, key, { vendor, prefix, owner, extra });
  });
  const cfg = readConfig(file);
  const { models: merged, added, updated, skipped, pruned } = mergeModels(cfg.models, incoming, base, owner, false);
  const available = cfg.availableModels ? [...new Set([...cfg.availableModels, ...good.map((r) => r.id)])] : undefined;
  const out = { ok: true, file, rows, written: good.map((r) => r.id), added, updated, skipped, pruned, merged: null };
  if (dryRun) return { ...out, preview: merged };
  out.backup = writeConfig(file, cfg, merged, available).backup;
  out.merged = await waitForMerge(good[0].id, mergeTimeoutMs);
  return out;
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
