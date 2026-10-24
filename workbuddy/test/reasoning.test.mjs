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
