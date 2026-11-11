import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deliverTelegramChangelog, performBuild, safeErrorDetails } from '../node/lib/build.mjs';
import { sendTelegramDocument, sendTelegramMessage } from '../node/lib/telegram.mjs';

function assertSafeLogs(logs) {
  const output = JSON.stringify(logs);
  for (const secret of ['SECRET_BOT_TOKEN', 'https://api.telegram.org/bot', 'PRIVATE_PAYLOAD', 'PRIVATE_MESSAGE', 'PRIVATE_STACK', 'SNEAKY_CODE']) {
    assert.equal(output.includes(secret), false, `leaked ${secret}`);
  }
  return output;
}

test('error details keep only allowlisted names and network codes', () => {
  const nested = Object.assign(new Error('PRIVATE_MESSAGE'), { code: 'ECONNREFUSED' });
  nested.stack = 'PRIVATE_STACK';
  const sneaky = Object.assign(new Error('PRIVATE_MESSAGE'), { code: 'SNEAKY_CODE' });
  const error = new TypeError('https://api.telegram.org/botSECRET_BOT_TOKEN PRIVATE_PAYLOAD', { cause: nested });
  const details = assertSafeLogs([[safeErrorDetails(error)], [safeErrorDetails(new Error('x', { cause: sneaky }))]]);
  assert.match(details, /TypeError/);
  assert.match(details, /ECONNREFUSED/);
});

test('hostile metadata getters are never invoked', () => {
  const invoked = [];
  const hostile = new Error('PRIVATE_MESSAGE');
  for (const key of ['name', 'code', 'cause', 'errors']) {
    Object.defineProperty(hostile, key, { get() { invoked.push(key); throw new Error('PRIVATE_PAYLOAD'); } });
  }
  assertSafeLogs([[safeErrorDetails(hostile)]]);
  assert.deepEqual(invoked, []);
});

test('nested AggregateError exposes allowlisted network codes', () => {
  const timeout = Object.assign(new Error('PRIVATE_MESSAGE'), { code: 'ETIMEDOUT' });
  const unreachable = Object.assign(new Error('PRIVATE_PAYLOAD'), { code: 'EHOSTUNREACH' });
  const aggregate = new AggregateError([timeout, new AggregateError([unreachable], 'PRIVATE_STACK')], 'PRIVATE_MESSAGE');
  const details = assertSafeLogs([[safeErrorDetails(new TypeError('PRIVATE_PAYLOAD', { cause: aggregate }))]]);
  assert.match(details, /ETIMEDOUT/);
  assert.match(details, /EHOSTUNREACH/);
});

test('AggregateError proxy traps and revoked proxies cannot interrupt diagnostics', () => {
  const invoked = [];
  const errors = new Proxy([Object.assign(new Error('PRIVATE_MESSAGE'), { code: 'ETIMEDOUT' })], {
    get(_target, key) { invoked.push(String(key)); throw new Error('PRIVATE_PAYLOAD'); },
  });
  const trapped = new AggregateError([], 'PRIVATE_MESSAGE');
  Object.defineProperty(trapped, 'errors', { value: errors });
  assert.match(safeErrorDetails(trapped), /ETIMEDOUT/);
  assert.deepEqual(invoked, []);

  const { proxy, revoke } = Proxy.revocable([new Error('PRIVATE_MESSAGE')], {});
  const revoked = new AggregateError([], 'PRIVATE_PAYLOAD');
  Object.defineProperty(revoked, 'errors', { value: proxy });
  revoke();
  const details = assertSafeLogs([[safeErrorDetails(revoked)]]);
  assert.match(details, /AggregateError/);
  assert.doesNotMatch(details, /TypeError/);
});

test('Telegram API rejection does not log an untrusted response body', async (t) => {
  const logs = [];
  const originalError = console.error;
  const originalFetch = globalThis.fetch;
  console.error = (...args) => logs.push(args);
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, description: 'PRIVATE_PAYLOAD https://api.telegram.org/botSECRET_BOT_TOKEN' }), { status: 400 });
  t.after(() => { console.error = originalError; globalThis.fetch = originalFetch; });
  const result = await sendTelegramMessage({ botToken: 'SECRET_BOT_TOKEN', chatId: '-1001', text: 'PRIVATE_PAYLOAD' });
  assert.equal(result, false);
  assert.match(assertSafeLogs(logs), /400/);
});

test('changelog document API rejection is not logged and not retried', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tunai-document-reject-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectRoot, 'changelog.md'), '# Changelog\n');
  const errors = [];
  const originalError = console.error;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  console.error = (...args) => errors.push(args);
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response(JSON.stringify({ ok: false, description: 'PRIVATE_PAYLOAD https://api.telegram.org/botSECRET_BOT_TOKEN/sendDocument' }), { status: 400 });
  };
  t.after(() => { console.error = originalError; globalThis.fetch = originalFetch; });
  const delivered = await deliverTelegramChangelog({
    projectRoot,
    changelogRelativePath: 'changelog.md',
    telegram: { bot_token: 'SECRET_BOT_TOKEN', chat_id: '-1001' },
    appName: 'TunaiPro', platform: 'ios', version: '1.0.1+1',
    sendDocumentImpl: sendTelegramDocument,
  });
  assert.equal(delivered, false);
  assert.equal(fetchCalls, 1);
  assert.match(assertSafeLogs(errors), /HTTP 400/);
});

test('document transport exception is safe in build and failure notification', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tunai-document-build-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const binDir = path.join(projectRoot, 'bin');
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, 'flutter'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const apkDir = path.join(projectRoot, 'build/app/outputs/flutter-apk');
  fs.mkdirSync(apkDir, { recursive: true });
  fs.writeFileSync(path.join(apkDir, 'app-release.apk'), 'fixture');
  fs.writeFileSync(path.join(projectRoot, 'pubspec.yaml'), 'name: demo\nversion: 1.0.0+1\n');
  fs.writeFileSync(path.join(projectRoot, 'changelog.md'), '# Change\n');
  const previousPath = process.env.PATH;
  const previousExit = process.exit;
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const previousLog = console.log;
  const previousWarn = console.warn;
  process.env.PATH = `${binDir}:${previousPath}`;
  const logs = [];
  console.error = (...args) => logs.push(args);
  console.log = (...args) => logs.push(args);
  console.warn = (...args) => logs.push(args);
  process.exit = (code) => { throw new Error(`Exit ${code}`); };
  const notifications = [];
  globalThis.fetch = async (_url, options) => {
    notifications.push(String(options.body));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
  };
  t.after(() => {
    process.env.PATH = previousPath;
    process.exit = previousExit;
    globalThis.fetch = previousFetch;
    console.error = previousError;
    console.log = previousLog;
    console.warn = previousWarn;
  });
  let documentCalls = 0;
  const config = { telegram: { bot_token: 'SECRET_BOT_TOKEN', chat_id: '-1001' } };
  await assert.rejects(performBuild({
    projectRoot, config, platform: 'android', update: false,
    performUploadImpl: async () => deliverTelegramChangelog({
      projectRoot, changelogRelativePath: 'changelog.md',
      telegram: config.telegram,
      appName: 'Demo', platform: 'android', version: '1.0.0+1',
      sendDocumentImpl: async () => {
        documentCalls++;
        const cause = Object.assign(new Error('PRIVATE_MESSAGE'), { code: 'ETIMEDOUT' });
        throw new TypeError('https://api.telegram.org/botSECRET_BOT_TOKEN/sendDocument PRIVATE_STACK', { cause });
      },
    }),
  }), /Exit 1/);
  assert.equal(documentCalls, 1);
  assert.equal(notifications.length, 1);
  const output = assertSafeLogs([...logs, ...notifications.map((body) => [body])]);
  assert.match(output, /document/);
  assert.match(output, /TypeError/);
  assert.match(output, /ETIMEDOUT/);
});
