/**
 * 思考强度（reasoning effort）
 *
 * WorkBuddy 侧（已在 WorkBuddy 安装包内只读核实，见 DESIGN.md §8）：
 *   models.json 自定义模型写 supportsReasoning:true + reasoning:{ defaultEffort, supportedEfforts, canDisableThinking }
 *   模型详情卡才会出现「思考强度」；发请求时 WorkBuddy 默认按 OpenAI Chat 格式带 reasoning_effort，
 *   若条目里有 compat.thinkingFormat（deepseek / qwen / zai …）则由 WorkBuddy 自己改写成对应字段。
 *
 * 本模块：按模型家族给出默认建议、用与 WorkBuddy 一致的请求格式做一次小探测，不支持就降级。
 */
export const EFFORTS = ['off', 'low', 'medium', 'high'];
export const EFFORT_LABEL = { off: '关闭', low: '低', medium: '中', high: '高' };
export const SUPPORTED_EFFORTS = ['low', 'medium', 'high'];

export function familyOf(id) {
  const s = String(id).toLowerCase();
  if (/(^|\/)(gpt-5|o[1-9]\b|o[1-9]-|gpt-oss|codex)/.test(s)) return 'openai';
  if (/claude/.test(s)) return 'claude';
  if (/gemini/.test(s)) return 'gemini';
  if (/deepseek/.test(s)) return 'deepseek';
  if (/qwen|qwq/.test(s)) return 'qwen';
  if (/glm|zhipu/.test(s)) return 'glm';
  if (/kimi|moonshot/.test(s)) return 'kimi';
  if (/grok/.test(s)) return 'grok';
  return 'other';
}

/** 导入页的默认建议：大概率支持思考的模型默认「中」，其它默认「关闭」（探测会最终把关） */
export function suggestEffort(id) {
  const s = String(id).toLowerCase();
  if (/(-instruct|-chat$|turbo|gpt-4o|gpt-4\.1|gpt-3|haiku-3|nano)/.test(s) && !/thinking|reason/.test(s)) return 'off';
  if (/thinking|reason|(^|\/)o[1-9]|gpt-5|gpt-oss|claude-(opus|sonnet)-(4|5)|claude-3-7|claude-(opus|sonnet)-[4-9]|gemini-(2\.5|[3-9])|deepseek-(r1|v3\.[1-9]|v[4-9])|qwen3|qwq|glm-(4\.[5-9]|[5-9])|kimi-k2|grok-(3-mini|[4-9])/.test(s)) return 'medium';
  return 'off';
}

/**
 * 要尝试的请求格式（按顺序）。fmt = WorkBuddy compat.thinkingFormat 的取值；openai 为默认（不用写 compat）。
 * Claude / Gemini 经 new-api / sub2api 的 OpenAI 兼容接口时，由中转站把 reasoning_effort 转成 thinking / thinkingConfig，
 * 所以同样只发 reasoning_effort；中转站不转换就会被探测出来并降级。
 */
export function formatsFor(id) {
  const fam = familyOf(id);
  const list = [{ fmt: 'openai', body: (e) => ({ reasoning_effort: e }) }];
  if (fam === 'deepseek') list.push({ fmt: 'deepseek', body: () => ({ thinking: { type: 'enabled' } }) });
  if (fam === 'qwen') list.push({ fmt: 'qwen', body: () => ({ enable_thinking: true }) });
  if (fam === 'glm') list.push({ fmt: 'zai', body: () => ({ thinking: { type: 'enabled', clear_thinking: false } }) });
  return list;
}

const usesCompletionTokens = (id) => /^(o1|o3|o4|gpt-4\.1|gpt-5)/.test(String(id)); // 与 WorkBuddy MaxTokensFieldRule 一致

/** 校验思考探测的响应：必须 JSON + choices；顺便看能否确认真的在思考 */
export function checkReasoningResponse(contentType, text) {
  const ct = String(contentType || '').toLowerCase();
  if (!ct.includes('json')) return { ok: false, reason: `非 JSON 响应（${ct || '无 content-type'}）` };
  let j; try { j = JSON.parse(text); } catch { return { ok: false, reason: '响应不是合法 JSON' }; }
  if (!Array.isArray(j?.choices) || !j.choices.length) return { ok: false, reason: j?.error?.message ? `中转站报错：${String(j.error.message).slice(0, 100)}` : '响应缺少 choices' };
  const msg = j.choices[0]?.message || {};
  const rt = Number(j?.usage?.completion_tokens_details?.reasoning_tokens || 0);
  const confirmed = rt > 0 || !!(msg.reasoning_content || msg.reasoning || msg.thinking);
  return { ok: true, confirmed };
}

/** 对一个模型做思考强度探测；返回 { ok, format, confirmed } 或 { ok:false, reason } */
export async function probeReasoning(base, key, model, effort, { fetchImpl = fetch, timeoutMs = 45000 } = {}) {
  if (!effort || effort === 'off') return { ok: true, format: null, confirmed: false, skipped: true };
  let last = '';
  for (const f of formatsFor(model)) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const tok = usesCompletionTokens(model) ? { max_completion_tokens: 2048 } : { max_tokens: 2048 };
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: '1+1=?' }], stream: false, ...tok, ...f.body(effort) }),
      });
      const text = await res.text();
      if (res.ok) {
        const r = checkReasoningResponse(res.headers.get('content-type'), text);
        if (r.ok) return { ok: true, format: f.fmt, confirmed: r.confirmed };
        last = r.reason;
      } else {
        let m = ''; try { m = JSON.parse(text)?.error?.message || JSON.parse(text)?.message || ''; } catch { m = text.slice(0, 80); }
        last = `HTTP ${res.status}${m ? `：${String(m).slice(0, 100)}` : ''}`;
      }
    } catch (e) { last = e.name === 'AbortError' ? '超时' : String(e.message).slice(0, 100); }
    finally { clearTimeout(t); }
  }
  return { ok: false, reason: last };
}

/** 生成写进 models.json 的思考相关字段 */
export function reasoningFields(effort, format) {
  if (!effort || effort === 'off') return { supportsReasoning: false };
  return {
    supportsReasoning: true,
    reasoning: { defaultEffort: effort, supportedEfforts: [...SUPPORTED_EFFORTS], canDisableThinking: true },
    ...(format && format !== 'openai' ? { compat: { thinkingFormat: format } } : {}),
  };
}
