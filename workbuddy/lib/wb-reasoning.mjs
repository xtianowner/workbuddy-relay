/** WorkBuddy configuration adapter for the shared upstream declaration parser.
 * This module never sends generation probes and never guesses capabilities from model names.
 */
export const WB_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const EFFORTS = ['auto', 'off', ...WB_LEVELS];
export const EFFORT_LABEL = { auto: '按上游声明', off: '关闭', unknown: '未声明', low: '低', medium: '中', high: '高', xhigh: '超高', max: '极致' };

// Display grouping only. Never used to choose capabilities, protocol or defaults.
export function familyOf(id) {
  const s = String(id).toLowerCase();
  if (/(^|\/)(gpt-|o[1-9]\b|codex)/.test(s)) return 'openai';
  for (const family of ['claude', 'gemini', 'deepseek', 'qwen', 'glm', 'kimi', 'grok']) if (s.includes(family)) return family;
  return 'other';
}

/** Build only the fields supported by the current upstream declaration and WorkBuddy client.
 * `previous` is supplied only after the caller proves exact endpoint and credential equality.
 */
export function reasoningForImport(capability, desired = 'auto', previous = null) {
  const clear = { supportsReasoning: undefined, reasoning: undefined, compat: undefined };
  const status = capability?.source && capability.source !== 'unknown' ? 'declared' : 'unknown';
  const row = {
    effort: 'unknown', levels: null, canDisable: capability?.canDisable ?? null,
    capabilityStatus: status, capabilitySource: capability?.source || 'unknown',
    effortSelection: capability?.effortSelection || 'unknown', note: '', extra: clear,
  };
  const preserve = (note) => {
    if (previous && !(capability?.canDisable === false && previous.supportsReasoning === false)) {
      row.extra = { ...clear, ...Object.fromEntries(['supportsReasoning', 'reasoning', 'compat'].filter(k => Object.hasOwn(previous, k)).map(k => [k, structuredClone(previous[k])])) };
      row.effort = previous.reasoning?.defaultEffort || (previous.supportsReasoning === false ? 'off' : 'unknown');
      row.levels = previous.reasoning?.supportedEfforts || null;
      row.canDisable = previous.reasoning?.canDisableThinking ?? row.canDisable;
      row.preserved = true;
      if (capability?.canDisable === false && row.extra.reasoning) { row.extra.reasoning.canDisableThinking = false; row.canDisable = false; }
    }
    row.note = `${note}；${row.preserved ? '保留当前地址和凭据的原有思考配置' : '未生成未经声明的思考档位'}`;
    return row;
  };
  if (desired === 'off') {
    if (capability?.canDisable === false) return { ...row, rejected: true, note: '上游声明不能关闭思考，未导入该模型' };
    return { ...row, effort: 'off', extra: { ...clear, supportsReasoning: false }, note: capability?.canDisable === true ? '按上游声明关闭思考' : '按选择不发送思考设置；上游是否实际关闭未知' };
  }
  if (capability?.reasoning === false) {
    if (desired !== 'auto') return { ...row, rejected: true, note: '上游声明此模型不支持思考，未导入该模型' };
    return { ...row, effort: 'off', extra: { ...clear, supportsReasoning: false }, note: '上游声明此模型不支持思考' };
  }
  if (desired === 'auto' && (capability?.defaultEffort === 'none' || capability?.defaultEnabled === false) && capability?.canDisable !== false) {
    return { ...row, effort: 'off', extra: { ...clear, supportsReasoning: false }, note: '按上游声明的默认关闭状态配置' };
  }
  if (capability?.effortSelection === 'unavailable') return { ...row, note: '上游未提供离散档位选择，未生成或沿用旧思考档位' };
  if (capability?.effortSelection !== 'declared' || !Array.isArray(capability.effortLevels)) {
    return preserve(capability?.effortSelection === 'unrestricted' ? '上游接受不限档位，但未提供具体可选列表' : status === 'unknown' ? '上游未声明思考能力' : '上游未声明可供 WorkBuddy 使用的离散档位');
  }
  const levels = capability.effortLevels.filter(v => WB_LEVELS.includes(v));
  row.levels = levels;
  if (desired !== 'auto' && !levels.includes(desired)) return { ...row, rejected: true, note: '所选思考档位不在上游声明且 WorkBuddy 可用的列表中，未导入该模型' };
  if (!levels.length) return { ...row, note: '上游没有声明 WorkBuddy 可表示的思考档位，未生成或沿用旧档位' };
  const selected = desired !== 'auto' ? desired : levels.includes(capability.defaultEffort) ? capability.defaultEffort : null;
  const reasoning = { supportedEfforts: levels };
  if (selected) reasoning.defaultEffort = selected;
  if (typeof capability.canDisable === 'boolean') reasoning.canDisableThinking = capability.canDisable;
  return {
    ...row, effort: selected || 'auto',
    extra: { ...clear, supportsReasoning: true, reasoning },
    note: selected ? '已按当前上游声明设置思考档位' : '已读取上游档位；上游未声明可用默认值，未自行选择默认档位',
  };
}
