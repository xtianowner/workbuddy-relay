import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { runImport } from '../lib/wb-flow.mjs';
import { discoverModels, mergeModels, buildEntry } from '../lib/wb-core.mjs';

const logger = { addSecret() {}, record() {} };
async function fixture(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-upstream-declarations-'));
  const configPath = path.join(dir, 'models.json');
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method, url: req.url, body });
    const result = handler(req, body);
    res.writeHead(result.status || 200, { 'content-type': 'application/json', ...result.headers });
    res.end(JSON.stringify(result.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  return { base, configPath, requests, run: options => runImport({ base, key: 'fixture-key-a', models: [{ id: 'opaque-model', effort: 'auto' }], configPath, logger, mergeTimeoutMs: 0, ...options }) };
}

test('actual HTTP metadata GET drives saved WorkBuddy fields without reasoning generation probes', async t => {
  const f = await fixture(t, () => ({ body: { data: [{ id: 'opaque-model', reasoning: { supported_efforts: ['max', 'low'], default_effort: 'max', mandatory: true } }] } }));
  const result = await f.run({ skipProbe: true, protocol: 'openai-chat' });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].capabilityStatus, 'declared');
  assert.deepEqual(result.rows[0].levels, ['max', 'low']);
  assert.deepEqual(f.requests.map(r => [r.method, r.url]), [['GET', '/v1/models']]);
  const [saved] = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
  assert.deepEqual(saved.reasoning, { supportedEfforts: ['max', 'low'], defaultEffort: 'max', canDisableThinking: false });
  assert.equal(saved.supportsReasoning, true);
});

test('unverified native protocols and invalid selections fail before any request or write', async t => {
  const f = await fixture(t, () => { throw new Error('must not request'); });
  for (const protocol of ['anthropic-messages', 'openai-responses', 'typo']) {
    await assert.rejects(f.run({ protocol }), { code: protocol === 'typo' ? 'INVALID_PROTOCOL' : 'CLIENT_PROTOCOL_UNVERIFIED' });
    await assert.rejects(f.run({ models: [{ id: 'opaque-model', protocol }] }), { code: protocol === 'typo' ? 'INVALID_PROTOCOL' : 'CLIENT_PROTOCOL_UNVERIFIED' });
  }
  assert.deepEqual(f.requests, []);
  assert.equal(fs.existsSync(f.configPath), false);
});

test('automatic detection stays Chat-only when Chat is rejected', async t => {
  const f = await fixture(t, req => req.method === 'GET'
    ? { body: { data: [{ id: 'opaque-model' }] } }
    : { status: 404, body: { error: { message: 'chat unavailable' } } });
  const result = await f.run({ protocol: 'auto' });
  assert.equal(result.ok, false);
  assert.deepEqual(f.requests.map(r => r.url), ['/v1/models', '/v1/chat/completions']);
  assert.equal(fs.existsSync(f.configPath), false);
});

test('skipProbe auto needs an exact preexisting Chat profile', async t => {
  const f = await fixture(t, () => ({ body: { data: [{ id: 'opaque-model' }] } }));
  await assert.rejects(f.run({ skipProbe: true }), { code: 'PROTOCOL_UNVERIFIED' });
  fs.writeFileSync(f.configPath, JSON.stringify([{ id: 'opaque-model', url: `${f.base}/chat/completions`, apiKey: 'fixture-key-a' }]));
  assert.equal((await f.run({ skipProbe: true, dryRun: true })).preview[0].wbProtocol, 'openai-chat');
  await assert.rejects(f.run({ skipProbe: true, key: 'fixture-key-b' }), { code: 'PROTOCOL_UNVERIFIED' });
});

test('missing metadata stays unknown and only exact endpoint plus credential can retain previous reasoning', async t => {
  const f = await fixture(t, () => ({ body: { data: [{ id: 'opaque-model' }] } }));
  const fresh = await f.run({ skipProbe: true, protocol: 'openai-chat', dryRun: true });
  assert.equal(fresh.rows[0].effort, 'unknown');
  assert.equal(fresh.preview[0].supportsReasoning, undefined);
  assert.equal(fresh.preview[0].reasoning, undefined);
  fs.writeFileSync(f.configPath, JSON.stringify([{ id: 'opaque-model', url: `${f.base}/chat/completions`, apiKey: 'fixture-key-a', supportsReasoning: true, reasoning: { defaultEffort: 'high', supportedEfforts: ['high', 'max'], canDisableThinking: false } }]));
  const retained = await f.run({ skipProbe: true, protocol: 'openai-chat', dryRun: true });
  assert.equal(retained.rows[0].preserved, true);
  assert.equal(retained.rows[0].effort, 'high');
  const rotated = await f.run({ key: 'fixture-key-b', skipProbe: true, protocol: 'openai-chat', dryRun: true });
  assert.equal(rotated.rows[0].preserved, undefined);
  assert.equal(rotated.preview[0].reasoning, undefined);
  assert.equal(rotated.preview[0].supportsReasoning, undefined);
});

test('a same-host different endpoint remains a separate site and prune preserves its models', () => {
  const base = 'https://relay.invalid/plan-a/v1';
  const existing = [
    { id: 'same-name', url: 'https://relay.invalid/plan-b/v1/chat/completions', wbImportOwner: 'mine' },
    { id: 'other-plan', url: 'https://relay.invalid/plan-b/v1/chat/completions', wbImportOwner: 'mine' },
  ];
  const result = mergeModels(existing, [buildEntry('same-name', base, 'synthetic', { owner: 'mine' })], base, 'mine', true);
  assert.deepEqual(result.models, existing);
  assert.deepEqual(result.pruned, []);
  assert.equal(result.skipped.length, 1);
});

test('basic availability probes remain separate and never carry reasoning parameters', async t => {
  const f = await fixture(t, req => req.method === 'GET'
    ? { body: { models: [{ slug: 'opaque-model', supported_reasoning_levels: ['low', 'high'], default_reasoning_level: 'high' }] } }
    : { body: { choices: [{ message: { content: 'ok' } }] } });
  const result = await f.run({ dryRun: true });
  assert.equal(result.ok, true);
  assert.deepEqual(f.requests.map(r => r.method), ['GET', 'POST']);
  assert.equal(f.requests[1].body.reasoning_effort, undefined);
  assert.equal(f.requests[1].body.thinking, undefined);
  assert.equal(f.requests[1].body.enable_thinking, undefined);
  assert.equal(result.preview[0].reasoning.defaultEffort, 'high');
});

test('upstream mandatory or unsupported effort prevents writing an invalid model', async t => {
  const f = await fixture(t, () => ({ body: { data: [{ id: 'opaque-model', reasoning: { supported_efforts: ['low'], mandatory: true } }] } }));
  for (const effort of ['off', 'max']) {
    const result = await f.run({ skipProbe: true, protocol: 'openai-chat', models: [{ id: 'opaque-model', effort }] });
    assert.equal(result.ok, false);
    assert.equal(result.rows[0].usable, false);
    assert.equal(fs.existsSync(f.configPath), false);
  }
});

test('metadata outage preserves unknown state, whereas catalog authentication failure stops before writes', async t => {
  const f = await fixture(t, req => ({ status: req.headers.authorization === 'Bearer fixture-key-b' ? 401 : 503, body: { error: { message: 'fixture failure' } } }));
  const unknown = await f.run({ skipProbe: true, protocol: 'openai-chat', dryRun: true });
  assert.equal(unknown.rows[0].capabilityStatus, 'unknown');
  assert.equal(unknown.preview[0].reasoning, undefined);
  await assert.rejects(f.run({ key: 'fixture-key-b', skipProbe: true, protocol: 'openai-chat' }), { code: 'MODEL_CATALOG_AUTH_FAILED' });
  assert.equal(fs.existsSync(f.configPath), false);
});

test('discovery preserves native slug declarations and never follows upstream redirects', async t => {
  const f = await fixture(t, req => req.url.startsWith('/v1/models')
    ? { status: 302, headers: { location: '/target' }, body: {} }
    : { body: { data: [{ id: 'never-requested' }] } });
  const found = await discoverModels(f.base, 'fixture-key-a', 1000, { logger });
  assert.ok(found.fatal);
  assert.deepEqual(f.requests.map(r => r.url), ['/v1/models']);
});


test('same key at a different Base URL never supplies prior reasoning', async t => {
  const f = await fixture(t, () => ({ body: { data: [{ id: 'opaque-model' }] } }));
  fs.writeFileSync(f.configPath, JSON.stringify([{ id: 'opaque-model', url: `${f.base}/other/chat/completions`, apiKey: 'fixture-key-a', supportsReasoning: true, reasoning: { defaultEffort: 'high', supportedEfforts: ['high'] } }]));
  const result = await f.run({ skipProbe: true, protocol: 'openai-chat', dryRun: true });
  assert.equal(result.rows[0].preserved, undefined);
  assert.equal(result.ok, false); // separate endpoint retained, same model id skipped
});

test('legacy cleanup never deletes Responses, Anthropic or other same-host versioned entries', () => {
  const base = 'https://relay.invalid/plan-a/v1';
  const existing = ['/responses', '/messages', '/chat/completions'].map((suffix, i) => ({ id: `other-${i}`, url: `https://relay.invalid/plan-b/v1${suffix}`, wbImportOwner: 'wb-setup-v1' }));
  const result = mergeModels(existing, [buildEntry('new', base, 'synthetic', { owner: 'wb-setup-v1' })], base, 'wb-setup-v1', true);
  assert.deepEqual(result.pruned, []);
  assert.deepEqual(result.models.slice(0, 3), existing);
});

test('strict shared Chat detection rejects redirects and empty or wrong response shapes', async t => {
  for (const body of [{ choices: [] }, { id: 'resp_1', output: [] }, { choices: [{}] }]) {
    const f = await fixture(t, req => req.method === 'GET' ? { body: { data: [{ id: 'opaque-model' }] } } : { body });
    assert.equal((await f.run()).ok, false);
    assert.equal(fs.existsSync(f.configPath), false);
  }
  const f = await fixture(t, req => req.method === 'GET' ? { body: { data: [{ id: 'opaque-model' }] } } : { status: 302, headers: { location: '/redirect-target' }, body: {} });
  assert.equal((await f.run()).ok, false);
  assert.ok(f.requests.every(r => r.url !== '/redirect-target'));
  assert.equal(fs.existsSync(f.configPath), false);
});

test('CLI stdin-json protocol is honored before network and before configuration writes', async t => {
  const { spawn } = await import('node:child_process');
  const f = await fixture(t, () => ({ body: { data: [{ id: 'opaque-model' }] } }));
  const child = spawn(process.execPath, [new URL('../wb-import.mjs', import.meta.url).pathname, '--stdin-json', '--config', f.configPath], { env: { ...process.env, WB_RELAY_KEY: '', WB_RELAY_URL: '' } });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.resume();
  child.stdin.end(JSON.stringify({ url: f.base, key: 'fixture-cli-key', models: ['opaque-model'], protocol: 'anthropic-messages' }));
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.notEqual(code, 0);
  assert.match(stderr, /尚未验证/);
  assert.equal(fs.existsSync(f.configPath), false);
  assert.deepEqual(f.requests, []);
});
