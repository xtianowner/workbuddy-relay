import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestEffort, familyOf, formatsFor, checkReasoningResponse, probeReasoning, reasoningFields } from '../lib/wb-reasoning.mjs';
import { buildEntry, mergeModels } from '../lib/wb-core.mjs';

test('按家族给默认思考强度建议', () => {
  for (const id of ['gpt-5.5', 'o3-mini', 'claude-sonnet-4', 'claude-opus-4-1', 'gemini-2.5-pro', 'deepseek-r1', 'qwen3-235b', 'glm-4.6', 'kimi-k2-thinking', 'grok-4']) assert.equal(suggestEffort(id), 'medium', id);
  for (const id of ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-haiku', 'qwen2.5-72b-instruct', 'llama-3-70b']) assert.equal(suggestEffort(id), 'off', id);
  assert.equal(familyOf('deepseek-v3.1'), 'deepseek');
  assert.deepEqual(formatsFor('glm-4.6').map((f) => f.fmt), ['openai', 'zai']);
});
test('思考探测响应校验', () => {
  assert.equal(checkReasoningResponse('text/html', '<html>').ok, false);
  assert.equal(checkReasoningResponse('application/json', '{"error":{"message":"x"}}').ok, false);
  assert.deepEqual(checkReasoningResponse('application/json', '{"choices":[{"message":{"content":"2"}}],"usage":{"completion_tokens_details":{"reasoning_tokens":5}}}'), { ok: true, confirmed: true });
  assert.deepEqual(checkReasoningResponse('application/json', '{"choices":[{"message":{"content":"2"}}]}'), { ok: true, confirmed: false });
});
const fake = (fn) => async (url, init) => { const b = JSON.parse(init.body); const [code, obj] = fn(b); return new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json' } }); };
test('探测：支持 / 退回家族格式 / 降级', async () => {
  const ok = await probeReasoning('http://x/v1', 'k', 'gpt-5', 'high', { fetchImpl: fake((b) => { assert.equal(b.reasoning_effort, 'high'); assert.ok(b.max_completion_tokens); return [200, { choices: [{ message: { content: '2' } }] }]; }) });
  assert.deepEqual(ok, { ok: true, format: 'openai', confirmed: false });
  const ds = await probeReasoning('http://x/v1', 'k', 'deepseek-v3.1', 'medium', { fetchImpl: fake((b) => (b.thinking ? [200, { choices: [{ message: { content: '2', reasoning_content: 'r' } }] }] : [400, { error: { message: 'no' } }])) });
  assert.deepEqual(ds, { ok: true, format: 'deepseek', confirmed: true });
  const bad = await probeReasoning('http://x/v1', 'k', 'claude-sonnet-4', 'low', { fetchImpl: fake(() => [400, { error: { message: 'Unrecognized argument' } }]) });
  assert.equal(bad.ok, false); assert.match(bad.reason, /HTTP 400/);
});
test('models.json 思考字段（与 WorkBuddy 本地模型写入格式一致）', () => {
  assert.deepEqual(reasoningFields('high', 'openai'), { supportsReasoning: true, reasoning: { defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high'], canDisableThinking: true } });
  assert.deepEqual(reasoningFields('low', 'qwen').compat, { thinkingFormat: 'qwen' });
  assert.deepEqual(reasoningFields('off'), { supportsReasoning: false });
  // 关闭后重新导入：旧的 reasoning / compat 要被清掉
  const old = buildEntry('m', 'https://a/v1', 'k', { owner: 'o', extra: reasoningFields('high', 'deepseek') });
  const neu = buildEntry('m', 'https://a/v1', 'k', { owner: 'o', extra: { ...reasoningFields('off'), reasoning: undefined, compat: undefined } });
  const out = JSON.parse(JSON.stringify(mergeModels([old], [neu], 'https://a/v1', 'o', false).models));
  assert.equal(out[0].supportsReasoning, false); assert.equal(out[0].reasoning, undefined); assert.equal(out[0].compat, undefined);
});

import { parseSupportedLevels, nearestLevel, probeLevels, WB_LEVELS, EFFORTS } from '../lib/wb-reasoning.mjs';

test('EFFORTS 覆盖 WorkBuddy 的 6 档', () => {
  assert.deepEqual(WB_LEVELS, ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  for (const v of WB_LEVELS) assert.ok(EFFORTS.includes(v));
});

test('parseSupportedLevels: 解析真实中转站报错（smaragents 2026-10-24 实测原文）', () => {
  assert.deepEqual(parseSupportedLevels("Unsupported value: 'minimal' is not supported with the 'gpt-6-astra' model. Supported values are: 'low', 'medium', 'high', 'xhigh', and 'max'.；如需技术支持"), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(parseSupportedLevels("Invalid value: 'ultra'. Supported values are: 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', and 'max'."), ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(parseSupportedLevels('gpt-6.1-sol does not support reasoning effort "none"; use low, medium, high, xhigh or max；如需'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(parseSupportedLevels('Unrecognized argument'), null);
});

test('nearestLevel', () => {
  assert.equal(nearestLevel('medium', ['low', 'medium', 'high']), 'medium');
  assert.equal(nearestLevel('minimal', ['low', 'medium', 'high', 'xhigh', 'max']), 'low');
  assert.equal(nearestLevel('max', ['low', 'medium', 'high']), 'high');
});

const fakeLv = (fn) => async (url, init) => { const [st, body] = fn(JSON.parse(init.body)); return { ok: st < 300, status: st, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) }; };

test('probeLevels: 无效值报错列出的是全局枚举，必须逐档实测（smaragents gpt-6 实测行为）', async () => {
  const okSet = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
  const r = await probeLevels('http://x/v1', 'k', 'gpt-6', { fetchImpl: fakeLv((b) => (okSet.has(b.reasoning_effort) ? [200, { choices: [{ message: { content: 'x' } }] }]
    : [400, { error: { message: "Invalid value. Supported values are: 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', and 'max'." } }])) });
  assert.deepEqual(r, { levels: ['low', 'medium', 'high', 'xhigh', 'max'], canDisable: false, how: 'each' });
});

test('probeLevels: 被拒但不列出 → 逐档试', async () => {
  const okSet = new Set(['low', 'medium', 'high', 'none']);
  const r = await probeLevels('http://x/v1', 'k', 'm', { fetchImpl: fakeLv((b) => (okSet.has(b.reasoning_effort) ? [200, { choices: [{ message: { content: 'x' } }] }] : [400, { error: { message: 'bad' } }])) });
  assert.deepEqual(r, { levels: ['low', 'medium', 'high'], canDisable: true, how: 'each' });
});

test('probeLevels: 中转站忽略参数 → null（保守默认）', async () => {
  const r = await probeLevels('http://x/v1', 'k', 'm', { fetchImpl: fakeLv(() => [200, { choices: [{ message: { content: 'x' } }] }]) });
  assert.equal(r.levels, null); assert.equal(r.how, 'ignored');
});

test('reasoningFields 写入实测档位与 canDisableThinking', () => {
  assert.deepEqual(reasoningFields('medium', 'openai', ['low', 'medium', 'high', 'xhigh', 'max'], false),
    { supportsReasoning: true, reasoning: { defaultEffort: 'medium', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], canDisableThinking: false } });
});
