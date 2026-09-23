import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { Agent, getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici';
import { sendTelegramDocument, sendTelegramMessage } from '../node/lib/telegram.mjs';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function refusedUrl() {
  const server = http.createServer();
  const url = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return url;
}

test('redirect after accepted POST is not replayed on refused destination', async (t) => {
  const destination = await refusedUrl();
  let acceptedPosts = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') acceptedPosts++;
    req.resume();
    res.writeHead(302, { Location: destination });
    res.end();
  });
  const origin = await listen(server);
  t.after(() => server.close());
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (url, options) => {
    fetchCalls++;
    return originalFetch(`${origin}/sendMessage`, options);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(sendTelegramMessage({ botToken: 'test-token', chatId: '-1001', text: 'do not replay' }));
  assert.equal(acceptedPosts, 1);
  assert.equal(fetchCalls, 1);
});

test('global proxy dispatcher cannot turn a proxy refusal into a Telegram retry', async (t) => {
  const proxyUrl = await refusedUrl();
  const proxy = new ProxyAgent(proxyUrl);
  const previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(proxy);
  t.after(async () => {
    setGlobalDispatcher(previousDispatcher);
    await proxy.close();
  });
  let acceptedPosts = 0;
  const server = http.createServer((req, res) => {
    acceptedPosts++;
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: { message_id: 101 } }));
  });
  const origin = await listen(server);
  t.after(() => server.close());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, options) => originalFetch(`${origin}/sendMessage`, options);
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await sendTelegramMessage({ botToken: 'test-token', chatId: '-1001', text: 'direct only' });
  assert.equal(result.messageId, 101);
  assert.equal(acceptedPosts, 1);
});

test('Telegram fetch supplies its own standard direct dispatcher instead of a custom global one', async (t) => {
  const previousDispatcher = getGlobalDispatcher();
  const customDispatcher = { dispatch() { throw new Error('custom dispatcher used'); }, close: async () => {}, destroy() {} };
  setGlobalDispatcher(customDispatcher);
  t.after(() => setGlobalDispatcher(previousDispatcher));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.ok(options.dispatcher instanceof Agent);
    assert.notEqual(options.dispatcher, customDispatcher);
    assert.equal(options.redirect, 'error');
    return accepted(102);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await sendTelegramMessage({ botToken: 'test-token', chatId: '-1001', text: 'direct only' });
  assert.equal(result.messageId, 102);
  assert.equal(calls, 1);
});

test('direct refused connection is retried only twice with real fetch', async (t) => {
  const destination = await refusedUrl();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (_url, options) => {
    calls++;
    return originalFetch(`${destination}/sendMessage`, options);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    sendTelegramMessage({ botToken: 'test-token', chatId: '-1001', text: 'never accepted' }),
    (error) => error.cause?.code === 'ECONNREFUSED',
  );
  assert.equal(calls, 3);
});

function transportFailure(code) {
  return new TypeError('fetch failed', { cause: Object.assign(new Error('transport failure'), { code }) });
}

function accepted(messageId) {
  return new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }), { status: 200 });
}

test('temporary DNS failure retries message and persists one receipt after acknowledgement', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-retry-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const receiptPath = path.join(directory, 'receipt.json');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw transportFailure('EAI_AGAIN');
    return accepted(42);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await sendTelegramMessage({
    botToken: 'test-token', chatId: '-1001', text: 'part 2', receiptPath,
    receipt: { delivery: 'cumulative_summary', part: 2 },
  });
  assert.equal(calls, 2);
  assert.equal(result.messageId, 42);
  const entries = JSON.parse(fs.readFileSync(receiptPath, 'utf8')).deliveries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].part, 2);
  assert.equal(entries[0].message_id, 42);
});

test('connect failures stop after three attempts without claiming a receipt', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-retry-limit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const receiptPath = path.join(directory, 'receipt.json');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw transportFailure('ECONNREFUSED'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(
    sendTelegramMessage({ botToken: 'test-token', chatId: '-1001', text: 'part 2', receiptPath }),
    (error) => error.cause?.code === 'ECONNREFUSED',
  );
  assert.equal(calls, 3);
  assert.equal(fs.existsSync(receiptPath), false);
});

for (const [name, failure] of [
  ['generic fetch failure', new TypeError('fetch failed')],
  ['reset after possible write', transportFailure('ECONNRESET')],
  ['ambiguous socket timeout', transportFailure('ETIMEDOUT')],
  ['top-level code without transport cause', Object.assign(new TypeError('fetch failed'), { code: 'EAI_AGAIN' })],
]) {
  test(`${name} is not retried`, async (t) => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw failure; };
    t.after(() => { globalThis.fetch = originalFetch; });
    await assert.rejects(
      sendTelegramMessage({ botToken: 'test-token', chatId: '-1001', text: 'part 2' }),
      (error) => error === failure,
    );
    assert.equal(calls, 1);
  });
}

test('Telegram API rejection is not retried', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ ok: false, description: 'rejected' }), { status: 429 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  assert.equal(await sendTelegramMessage({ botToken: 'test-token', chatId: '-1001', text: 'part 2' }), false);
  assert.equal(calls, 1);
});

test('pre-connect timeout retries document and records its acknowledgement once', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-document-retry-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const receiptPath = path.join(directory, 'receipt.json');
  const filePath = path.join(directory, 'changelog.md');
  fs.writeFileSync(filePath, 'test changelog');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw transportFailure('UND_ERR_CONNECT_TIMEOUT');
    return accepted(43);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await sendTelegramDocument({
    botToken: 'test-token', chatId: '-1001', filePath, receiptPath,
    receipt: { delivery: 'cumulative_document' },
  });
  assert.equal(calls, 2);
  assert.equal(result.messageId, 43);
  const entries = JSON.parse(fs.readFileSync(receiptPath, 'utf8')).deliveries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'document');
  assert.equal(entries[0].message_id, 43);
});
