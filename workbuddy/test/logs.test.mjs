import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createLogger } from '../lib/wb-logs.mjs';

test('本地日志记录操作并在导出时脱敏', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-logs-'));
  try {
    const logger = createLogger({ dir, version: 'test', now: () => new Date('2026-10-28T12:00:00.000Z') });
    const fixtureKey = crypto.randomUUID();
    logger.addSecret(fixtureKey);
    logger.record('key.submitted', { key: fixtureKey, model: 'gpt-test', content: 'private prompt' });
    const status = logger.status();
    assert.equal(status.files, 1);
    assert.equal(status.bytes > 0, true);
    const raw = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8');
    assert.equal(raw.includes(fixtureKey), false);
    assert.equal(raw.includes('private prompt'), false);
    const bundle = logger.exportBundle({ reason: 'test' });
    assert.equal(bundle.data.subarray(0, 2).toString(), 'PK');
    assert.match(bundle.filename, /^workbuddy-relay-logs-/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
