import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupName,
  normalizeBase, candidates, extractIds, mergeModels, pickChatModels,
  buildEntry, writeConfig, readConfig,
} from '../lib/wb-core.mjs';

test('normalizeBase 去掉端点、query、尾斜杠，并补协议', () => {
  assert.equal(normalizeBase('https://a.com/v1/chat/completions'), 'https://a.com/v1');
  assert.equal(normalizeBase('https://a.com/v1/chat/completions?x=1#y'), 'https://a.com/v1');
  assert.equal(normalizeBase('https://a.com/v1///'), 'https://a.com/v1');
  assert.equal(normalizeBase('a.com'), 'https://a.com/v1');
  assert.equal(normalizeBase('https://www.relay.example.com'), 'https://www.relay.example.com/v1');
  assert.equal(normalizeBase('https://www.relay.example.com/chat/completions'), 'https://www.relay.example.com/v1');
  assert.equal(normalizeBase('https://a.com/v1/models'), 'https://a.com/v1');
  assert.equal(normalizeBase('  '), null);
});

test('candidates 只返回规范化后的唯一 base', () => {
  assert.deepEqual(candidates(normalizeBase('https://a.com')), ['https://a.com/v1']);
  assert.deepEqual(candidates('https://a.com/v1'), ['https://a.com/v1']);
  assert.deepEqual(candidates('https://a.com/v1beta'), ['https://a.com/v1beta']);
});

test('extractIds 兼容 data / models / 纯字符串数组', () => {
  assert.deepEqual(extractIds({ data: [{ id: 'a' }, { id: 'b' }] }), ['a', 'b']);
  assert.deepEqual(extractIds({ models: ['a', { id: 'b' }] }), ['a', 'b']);
  assert.deepEqual(extractIds(['a', 'b']), ['a', 'b']);
  assert.deepEqual(extractIds({ nope: 1 }), []);
});

test('mergeModels：同站更新、跨站跳过、按 owner 清理', () => {
  const existing = [
    { id: 'same-host', url: 'https://r.com/v1/chat/completions', name: 'old' },
    { id: 'other-host', url: 'https://other.com/v1/chat/completions' },
    { id: 'stale', url: 'https://r.com/v1/chat/completions', wbImportOwner: 'me' },
    { id: 'user-owned', url: 'https://r.com/v1/chat/completions' },
  ];
  const incoming = [
    buildEntry('same-host', 'https://r.com/v1', 'k', { owner: 'me' }),
    buildEntry('new-one', 'https://r.com/v1', 'k', { owner: 'me' }),
    buildEntry('other-host', 'https://r.com/v1', 'k', { owner: 'me' }),
  ];
  const r = mergeModels(existing, incoming, 'https://r.com/v1', 'me', true);
  assert.deepEqual(r.added, ['new-one']);
  assert.deepEqual(r.updated, ['same-host']);
  assert.deepEqual(r.skipped, ['other-host(同名但属于其它站点，已跳过)']);
  assert.deepEqual(r.pruned, ['stale']);
  assert.equal(r.models.length, 4);                        // same-host / other-host / user-owned / new-one
  assert.ok(r.models.some((m) => m.id === 'user-owned'));   // 用户自己的条目不动
});

test('pickChatModels 过滤非聊天模型并按上限截断', () => {
  const ids = ['gpt-4o', 'text-embedding-3-small', 'whisper-1', 'dall-e-3', 'claude-x'];
  assert.deepEqual(pickChatModels(ids), ['gpt-4o', 'claude-x']);
  assert.deepEqual(pickChatModels(['a', 'b', 'c'], 2), ['a', 'b']);
});

test('writeConfig：原子替换、留备份、保留 availableModels、权限 600', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-core-'));
  const file = path.join(dir, 'models.json');
  fs.writeFileSync(file, JSON.stringify({ models: [{ id: 'old', url: 'https://a/v1/chat/completions' }], availableModels: ['old'], extra: 'keep' }));

  const cfg = readConfig(file);
  assert.equal(cfg.shape, 'object');
  writeConfig(file, cfg, [...cfg.models, buildEntry('new', 'https://a/v1', 'k')], ['old', 'new']);

  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after.availableModels, ['old', 'new']);
  assert.equal(after.extra, 'keep');
  assert.equal(after.models.length, 2);
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('models.json.bak.')), '应生成备份');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readConfig：裸数组与空文件都能读', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-core-'));
  const arr = path.join(dir, 'a.json');
  fs.writeFileSync(arr, JSON.stringify([{ id: 'x' }]));
  assert.equal(readConfig(arr).shape, 'array');
  assert.deepEqual(readConfig(arr).models, [{ id: 'x' }]);

  const empty = path.join(dir, 'b.json');
  fs.writeFileSync(empty, '');
  assert.deepEqual(readConfig(empty).models, []);

  const broken = path.join(dir, 'c.json');
  fs.writeFileSync(broken, '{oops');
  assert.throws(() => readConfig(broken), /不是合法 JSON/);
  fs.rmSync(dir, { recursive: true, force: true });
});

import { validateChatResponse } from '../lib/wb-core.mjs';
test('回归 2.0.1：HTML 200 不算可用；JSON 必须含 choices', () => {
  assert.equal(validateChatResponse('text/html; charset=utf-8', '<!doctype html>').ok, false);
  assert.equal(validateChatResponse('application/json', '{"id":"x"}').ok, false);
  assert.equal(validateChatResponse('application/json', 'not json').ok, false);
  assert.equal(validateChatResponse('application/json; charset=utf-8', '{"choices":[]}').ok, true);
});
test('回归 2.0.1：过滤通配符模型 id', () => {
  assert.deepEqual(pickChatModels(['claude-*', 'codex-*', 'gpt-*', 'gpt-5.5', 'claude-sonnet-4']), ['gpt-5.5', 'claude-sonnet-4']);
});
test('回归 2.0.1：自动清理/修复旧版写坏的条目（仅本工具、同站点）', () => {
  const S = 'https://www.relay.example.com';
  const existing = [
    { id: 'claude-*', url: `${S}/chat/completions`, wbImportOwner: 'wb-setup-v1' },
    { id: 'gpt-5.5', url: `${S}/chat/completions`, wbImportOwner: 'wb-setup-v1' },
    { id: 'old-bad', url: `${S}/chat/completions`, wbImportOwner: 'wb-setup-v1' },
    { id: 'user-own', url: `${S}/chat/completions` },
    { id: 'other', url: 'https://x.com/chat/completions', wbImportOwner: 'wb-setup-v1' },
  ];
  const r = mergeModels(existing, [buildEntry('gpt-5.5', `${S}/v1`, 'k', { owner: 'wb-setup-v1' })], `${S}/v1`, 'wb-setup-v1', false);
  assert.deepEqual(r.models.map((m) => m.id), ['gpt-5.5', 'user-own', 'other']);
  assert.equal(r.models[0].url, `${S}/v1/chat/completions`);
  assert.deepEqual(r.pruned.sort(), ['claude-*', 'old-bad']);
});

test('backupName: 时间戳 14 位，结尾无点/空格（Windows 可正常删除）', () => {
  for (const d of [new Date('2026-10-24T14:57:01.123Z'), new Date('2026-01-01T00:00:00.000Z'), new Date()]) {
    const n = backupName('C:\\Users\\x\\.workbuddy\\models.json', d);
    assert.match(n, /\.bak\.\d{14}$/);
    assert.doesNotMatch(n, /[. ]$/);
  }
  assert.equal(backupName('/h/.workbuddy/models.json', new Date('2026-10-24T14:57:01.999Z')), '/h/.workbuddy/models.json.bak.20261024145701');
});
