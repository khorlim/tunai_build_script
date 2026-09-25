import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspect } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deliverTelegramChangelog, performBuild } from '../node/lib/build.mjs';
import { sendTelegramDocument, sendTelegramMessage } from '../node/lib/telegram.mjs';

function fixture(t) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tunai-summary-diagnostics-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectRoot, 'changelog.md'), '# Changelog\n');
  const logs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => logs.push(args);
  console.warn = (...args) => logs.push(args);
  t.after(() => { console.log = originalLog; console.warn = originalWarn; });
  const calls = [];
  const options = {
    projectRoot,
    changelogRelativePath: 'changelog.md',
    telegram: { bot_token: 'SECRET_BOT_TOKEN', chat_id: '-1001' },
    summaryConfig: { model: 'haiku' },
    appName: 'TunaiPro', platform: 'ios', version: '1.0.1+1',
    receiptPath: path.join(projectRoot, 'receipt.json'),
    sendDocumentImpl: async () => { calls.push('document'); return true; },
  };
  return { options, calls, logs };
}

function assertSafeLogs(logs) {
  const output = JSON.stringify(logs);
  for (const secret of ['SECRET_BOT_TOKEN', 'https://api.telegram.org/bot', 'PRIVATE_SUMMARY', 'PRIVATE_MESSAGE', 'PRIVATE_STACK', 'SNEAKY_CODE']) {
    assert.equal(output.includes(secret), false, `leaked ${secret}`);
  }
  return output;
}

test('generation failure logs safe stage and nested name/code without retaining original exception', async (t) => {
  const { options, calls, logs } = fixture(t);
  const nested = Object.assign(new Error('PRIVATE_MESSAGE PRIVATE_SUMMARY'), { code: 'ECONNREFUSED' });
  nested.stack = 'PRIVATE_STACK';
  const original = new TypeError('https://api.telegram.org/botSECRET_BOT_TOKEN/sendMessage PRIVATE_MESSAGE', { cause: nested });
  options.generateSummaryImpl = async () => { throw original; };
  options.sendMessageImpl = async () => { calls.push('message'); return true; };
  await assert.rejects(deliverTelegramChangelog(options), (error) => {
    assert.equal(error.cause, undefined);
    assert.match(error.message, /generation/);
    assertSafeLogs([[error.message]]);
    assertSafeLogs([[inspect(error, { depth: 10 })]]);
    assertSafeLogs([[error]]);
    return true;
  });
  assert.deepEqual(calls, []);
  const output = assertSafeLogs(logs);
  assert.match(output, /generation/);
  assert.match(output, /TypeError/);
  assert.match(output, /ECONNREFUSED/);
});

test('part-two send failure logs stage and allowlisted nested error data without replay', async (t) => {
  const { options, calls, logs } = fixture(t);
  const nested = Object.assign(new Error('PRIVATE_MESSAGE'), { code: 'SNEAKY_CODE' });
  const original = new TypeError('PRIVATE_SUMMARY', { cause: nested });
  options.generateSummaryImpl = async () => ['PRIVATE_SUMMARY first', 'PRIVATE_SUMMARY second', 'PRIVATE_SUMMARY third'];
  options.sendMessageImpl = async ({ receipt }) => {
    calls.push(receipt.part);
    if (receipt.part === 2) throw original;
    return true;
  };
  await assert.rejects(deliverTelegramChangelog(options), (error) => {
    assert.equal(error.cause, undefined);
    assert.match(error.message, /summary part 2 send/);
    assertSafeLogs([[error.message]]);
    assertSafeLogs([[inspect(error, { depth: 10 })]]);
    assertSafeLogs([[error]]);
    return true;
  });
  assert.deepEqual(calls, [1, 2]);
  const output = assertSafeLogs(logs);
  assert.match(output, /summary part 2 send/);
  assert.match(output, /TypeError/);
  assert.doesNotMatch(output, /SNEAKY_CODE/);
});

test('hostile metadata getters are never invoked during summary diagnostics', async (t) => {
  const { options, logs } = fixture(t);
  const invoked = [];
  const hostile = new Error('PRIVATE_MESSAGE');
  for (const key of ['name', 'code', 'cause', 'errors']) {
    Object.defineProperty(hostile, key, { get() { invoked.push(key); throw new Error('PRIVATE_SUMMARY'); } });
  }
  options.generateSummaryImpl = async () => { throw hostile; };
  await assert.rejects(deliverTelegramChangelog(options), (error) => {
    assert.equal(error.cause, undefined);
    assert.match(error.message, /generation/);
    assertSafeLogs([[inspect(error, { depth: 10 })]]);
    return true;
  });
  assert.deepEqual(invoked, []);
  assert.match(assertSafeLogs(logs), /generation/);
});

test('nested AggregateError exposes allowlisted Undici network codes without leaking payloads', async (t) => {
  const { options, logs } = fixture(t);
  const timeout = Object.assign(new Error('PRIVATE_MESSAGE'), { code: 'ETIMEDOUT' });
  const unreachable = Object.assign(new Error('PRIVATE_SUMMARY'), { code: 'EHOSTUNREACH' });
  const aggregate = new AggregateError([timeout, new AggregateError([unreachable], 'PRIVATE_STACK')], 'PRIVATE_MESSAGE');
  options.generateSummaryImpl = async () => { throw new TypeError('PRIVATE_SUMMARY', { cause: aggregate }); };
  await assert.rejects(deliverTelegramChangelog(options), (error) => {
    assert.equal(error.cause, undefined);
    assertSafeLogs([[inspect(error, { depth: 10 })]]);
    assert.match(error.message, /ETIMEDOUT/);
    assert.match(error.message, /EHOSTUNREACH/);
    return true;
  });
  assertSafeLogs(logs);
});

test('AggregateError array accessors and proxy traps cannot interrupt diagnostics', async (t) => {
  const { options, logs } = fixture(t);
  const invoked = [];
  const errors = new Proxy([Object.assign(new Error('PRIVATE_MESSAGE'), { code: 'ETIMEDOUT' })], {
    get(_target, key) { invoked.push(String(key)); throw new Error('PRIVATE_SUMMARY'); },
  });
  const aggregate = new AggregateError([], 'PRIVATE_MESSAGE');
  Object.defineProperty(aggregate, 'errors', { value: errors });
  options.generateSummaryImpl = async () => { throw aggregate; };
  await assert.rejects(deliverTelegramChangelog(options), (error) => {
    assert.match(error.message, /ETIMEDOUT/);
    assertSafeLogs([[inspect(error, { depth: 10 })]]);
    return true;
  });
  assert.deepEqual(invoked, []);
  assertSafeLogs(logs);
});

test('revoked AggregateError errors cannot replace original summary diagnostic', async (t) => {
  const { options, calls, logs } = fixture(t);
  const { proxy, revoke } = Proxy.revocable([new Error('PRIVATE_MESSAGE')], {});
  const aggregate = new AggregateError([], 'PRIVATE_SUMMARY');
  Object.defineProperty(aggregate, 'errors', { value: proxy });
  revoke();
  options.generateSummaryImpl = async () => { throw aggregate; };
  options.sendDocumentImpl = async () => { calls.push('document'); return true; };
  await assert.rejects(deliverTelegramChangelog(options), (error) => {
    assert.match(error.message, /generation/);
    assert.match(error.message, /AggregateError/);
    assert.doesNotMatch(error.message, /TypeError/);
    assert.equal(error.cause, undefined);
    assertSafeLogs([[inspect(error, { depth: 10 })]]);
    return true;
  });
  assert.deepEqual(calls, []);
  assert.match(assertSafeLogs(logs), /AggregateError/);
});

test('false summary delivery identifies the rejected part without changing later sends', async (t) => {
  const { options, calls, logs } = fixture(t);
  options.generateSummaryImpl = async () => ['PRIVATE_SUMMARY first', 'PRIVATE_SUMMARY second'];
  options.sendMessageImpl = async ({ receipt }) => {
    calls.push(receipt.part);
    return receipt.part !== 1;
  };
  await assert.rejects(deliverTelegramChangelog(options), (error) => {
    assert.match(error.message, /summary part 1 send/);
    assertSafeLogs([[error.message]]);
    return true;
  });
  assert.deepEqual(calls, [1, 2]);
  assert.match(assertSafeLogs(logs), /summary part 1 send/);
});

test('Telegram API rejection does not log an untrusted response body', async (t) => {
  const logs = [];
  const originalError = console.error;
  const originalFetch = globalThis.fetch;
  console.error = (...args) => logs.push(args);
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, description: 'PRIVATE_SUMMARY https://api.telegram.org/botSECRET_BOT_TOKEN' }), { status: 400 });
  t.after(() => { console.error = originalError; globalThis.fetch = originalFetch; });
  const result = await sendTelegramMessage({ botToken: 'SECRET_BOT_TOKEN', chatId: '-1001', text: 'PRIVATE_SUMMARY' });
  assert.equal(result, false);
  assert.match(assertSafeLogs(logs), /400/);
});

test('non-receipt summary fallback omits document API rejection body and does not retry', async (t) => {
  const { options, logs } = fixture(t);
  delete options.receiptPath;
  options.generateSummaryImpl = async () => { throw new Error('PRIVATE_SUMMARY'); };
  options.sendDocumentImpl = sendTelegramDocument;
  const errors = [];
  const originalError = console.error;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  console.error = (...args) => errors.push(args);
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response(JSON.stringify({ ok: false, description: 'PRIVATE_SUMMARY https://api.telegram.org/botSECRET_BOT_TOKEN/sendDocument' }), { status: 400 });
  };
  t.after(() => { console.error = originalError; globalThis.fetch = originalFetch; });
  const delivered = await deliverTelegramChangelog(options);
  assert.equal(delivered, false);
  assert.equal(fetchCalls, 1);
  assert.match(assertSafeLogs(errors), /HTTP 400/);
  assertSafeLogs(logs);
});

test('non-receipt summary failure warns safely and continues with document', async (t) => {
  const { options, calls, logs } = fixture(t);
  delete options.receiptPath;
  options.generateSummaryImpl = async () => ['PRIVATE_SUMMARY'];
  options.sendMessageImpl = async () => { calls.push('message'); throw new Error('PRIVATE_MESSAGE https://api.telegram.org/botSECRET_BOT_TOKEN'); };
  const delivered = await deliverTelegramChangelog(options);
  assert.equal(delivered, true);
  assert.deepEqual(calls, ['message', 'document']);
  assert.match(assertSafeLogs(logs), /summary part 1 send/);
});

test('summary CLI does not print a whole exception or its secret-bearing cause', (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tunai-summary-cli-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectRoot, 'pubspec.yaml'), 'name: demo\nversion: 1.0.0+1\n');
  fs.writeFileSync(path.join(projectRoot, 'changelog.md'), '# Change\n');
  const configPath = path.join(projectRoot, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ telegram: {
    bot_token: 'SECRET_BOT_TOKEN', chat_id: '-1001', changelog_summary: { enabled: true },
  } }));
  const preload = path.join(projectRoot, 'inject.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
const original = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  if (String(file).endsWith('/changelog.md')) {
    const cause = Object.assign(new Error('PRIVATE_MESSAGE'), { code: 'ECONNRESET' });
    throw new TypeError('https://api.telegram.org/botSECRET_BOT_TOKEN/sendMessage PRIVATE_SUMMARY', { cause });
  }
  return original.call(this, file, ...args);
};\n`);
  const cli = fileURLToPath(new URL('../node/bin/tunai-build-script.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', preload, cli,
    '--config', configPath, '--project-root', projectRoot,
    '--test-changelog-summary', 'changelog.md', '--platform', 'ios'],
  { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 1);
  const output = assertSafeLogs([[result.stdout, result.stderr]]);
  assert.match(output, /generation/);
  assert.match(output, /TypeError/);
  assert.match(output, /ECONNRESET/);
});

test('document transport exception after summary fallback is safe in build and failure notification', async (t) => {
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
      telegram: config.telegram, summaryConfig: { model: 'haiku' },
      appName: 'Demo', platform: 'android', version: '1.0.0+1',
      generateSummaryImpl: async () => { throw new Error('PRIVATE_SUMMARY'); },
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
