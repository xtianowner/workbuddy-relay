import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WB_LEVELS, EFFORTS, reasoningForImport } from '../lib/wb-reasoning.mjs';
import { parseReasoningCapabilities } from '../lib/vendor/reasoning.mjs';

const parse = model => Object.values(parseReasoningCapabilities([model]))[0];
const row = (reasoning, rest = {}) => parse({ id: 'opaque-model', reasoning, ...rest });

test('WorkBuddy selectable levels remain a client intersection, never a capability default', () => {
  assert.deepEqual(WB_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(EFFORTS, ['auto', 'off', ...WB_LEVELS]);
  const known = row({ supported_efforts: ['max', 'low', 'none'], default_effort: 'max', mandatory: false });
  const result = reasoningForImport(known);
  assert.deepEqual(result.levels, ['max', 'low']);
  assert.equal(result.effort, 'max');
  assert.deepEqual(result.extra, { supportsReasoning: true, reasoning: { supportedEfforts: ['max', 'low'], defaultEffort: 'max', canDisableThinking: true }, compat: undefined });
});

test('ordinary IDs, missing and malformed declarations never synthesize supported tiers', () => {
  for (const capability of [undefined, row(undefined), row({ supported_efforts: 'low,high' }), row({ supported_efforts: null })]) {
    const result = reasoningForImport(capability);
    assert.equal(result.effort, 'unknown');
    assert.equal(result.extra.supportsReasoning, undefined);
    assert.equal(result.extra.reasoning, undefined);
    assert.equal(result.canDisable, null);
  }
});

test('a declared list does not manufacture a medium default or disable support', () => {
  const result = reasoningForImport(row({ supported_efforts: ['low', 'high'] }));
  assert.equal(result.effort, 'auto');
  assert.deepEqual(result.extra.reasoning, { supportedEfforts: ['low', 'high'] });
  assert.equal(result.canDisable, null);
});

test('unknown declarations preserve caller-proven existing fields without converting unknown into supported', () => {
  const previous = { supportsReasoning: true, reasoning: { defaultEffort: 'high', supportedEfforts: ['high', 'max'], canDisableThinking: false }, compat: { thinkingFormat: 'custom' } };
  const result = reasoningForImport(undefined, 'auto', previous);
  assert.equal(result.preserved, true);
  assert.equal(result.capabilityStatus, 'unknown');
  assert.equal(result.effort, 'high');
  assert.deepEqual(result.extra, previous);
  assert.notEqual(result.extra.reasoning, previous.reasoning);
});

test('explicit empty, toggle and budget declarations clear obsolete discrete tiers instead of reusing them', () => {
  const previous = { supportsReasoning: true, reasoning: { defaultEffort: 'max', supportedEfforts: ['max'] } };
  for (const capability of [row({ supported_efforts: [] }), parse({ id: 'm', reasoning: true, reasoning_options: [{ type: 'toggle' }] }), parse({ id: 'm', reasoning: true, reasoning_options: [{ type: 'budget_tokens', min: 1024, max: 8192 }] })]) {
    const result = reasoningForImport(capability, 'auto', previous);
    assert.equal(result.extra.reasoning, undefined);
    assert.equal(result.preserved, undefined);
  }
});

test('mandatory reasoning and explicitly unsupported selections cannot be silently changed', () => {
  const known = row({ supported_efforts: ['low', 'high'], mandatory: true });
  assert.equal(reasoningForImport(known, 'off').rejected, true);
  assert.equal(reasoningForImport(known, 'max').rejected, true);
  assert.equal(reasoningForImport(known, 'low').extra.reasoning.canDisableThinking, false);
  assert.equal(reasoningForImport(row(false), 'high').rejected, true);
});

test('an explicit upstream default off is preserved; unknown off does not claim canDisable', () => {
  const known = row({ supported_efforts: ['none', 'low', 'high'], default_effort: 'none' });
  const result = reasoningForImport(known);
  assert.equal(result.effort, 'off');
  assert.equal(result.extra.supportsReasoning, false);
  const manual = reasoningForImport(undefined, 'off');
  assert.equal(manual.extra.supportsReasoning, false);
  assert.equal(manual.canDisable, null);
});

test('vendored parser agrees with the shared upstream conformance vectors', () => {
  const fixtures = JSON.parse(fs.readFileSync(new URL('./reasoning-fixtures.json', import.meta.url), 'utf8'));
  for (const fixture of fixtures) assert.deepEqual(parse(fixture.model), fixture.expected, fixture.name);
});

test('vendored router artifacts and all nine shared fixtures match pinned provenance', async () => {
  const { createHash } = await import('node:crypto');
  const vendor = new URL('../lib/vendor/', import.meta.url);
  const provenance = JSON.parse(fs.readFileSync(new URL('router-provenance.json', vendor), 'utf8'));
  assert.equal(provenance.version, '0.4.1-bridge.2');
  assert.equal(provenance.sourceRepository, 'https://github.com/xtianowner/llm-protocol-router');
  assert.equal(provenance.tarball.sha256, '4142810ebddbbca25a9512cbb155ea1d1691e6ff497f810a183773118be68623');
  for (const artifact of [...provenance.artifacts, provenance.reasoningFixtures]) {
    const bytes = fs.readFileSync(new URL(artifact.vendored, vendor));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, artifact.source);
  }
  const fixtures = JSON.parse(fs.readFileSync(new URL(provenance.reasoningFixtures.vendored, vendor), 'utf8'));
  assert.equal(provenance.reasoningFixtures.count, 9);
  assert.equal(fixtures.length, provenance.reasoningFixtures.count);
  for (const fixture of fixtures) assert.deepEqual(parse(fixture.model), fixture.expected, fixture.name);
});
