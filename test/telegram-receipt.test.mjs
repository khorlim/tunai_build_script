import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  sendTelegramDocument,
  sendTelegramMessage,
} from '../node/lib/telegram.mjs';

function telegramResponse({ messageId, chatId, topicId }) {
  return new Response(
    JSON.stringify({
      ok: true,
      result: {
        message_id: messageId,
        chat: { id: chatId },
        message_thread_id: topicId,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

test('Telegram sends return message IDs and atomically accumulate delivery receipts', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-receipt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const receiptPath = path.join(directory, 'delivery-receipts.json');
  const documentPath = path.join(directory, 'changelog.md');
  fs.writeFileSync(documentPath, '# Changelog\n', 'utf8');

  const responses = [
    telegramResponse({ messageId: 17910, chatId: -1001, topicId: 77 }),
    telegramResponse({ messageId: 17911, chatId: -1001, topicId: 77 }),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responses.shift();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const message = await sendTelegramMessage({
    botToken: 'test-token',
    chatId: '-1001',
    topicId: '77',
    text: 'summary',
    receiptPath,
    receipt: {
      delivery: 'incremental_summary',
      part: 1,
      total_parts: 1,
      version: '1.0.189+327',
    },
  });
  const document = await sendTelegramDocument({
    botToken: 'test-token',
    chatId: '-1001',
    topicId: '77',
    filePath: documentPath,
    caption: 'document',
    receiptPath,
    receipt: {
      delivery: 'incremental_document',
      version: '1.0.189+327',
    },
  });

  assert.deepEqual(message, {
    ok: true,
    messageId: 17910,
    chatId: '-1001',
    topicId: 77,
  });
  assert.equal(document.messageId, 17911);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.schema, 1);
  assert.deepEqual(
    receipt.deliveries.map((entry) => ({
      delivery: entry.delivery,
      kind: entry.kind,
      message_id: entry.message_id,
      chat_id: entry.chat_id,
      message_thread_id: entry.message_thread_id,
    })),
    [
      {
        delivery: 'incremental_summary',
        kind: 'message',
        message_id: 17910,
        chat_id: '-1001',
        message_thread_id: 77,
      },
      {
        delivery: 'incremental_document',
        kind: 'document',
        message_id: 17911,
        chat_id: '-1001',
        message_thread_id: 77,
      },
    ],
  );
  assert.equal(receipt.deliveries[1].file_name, 'changelog.md');
  assert.ok(receipt.updated_at);
  assert.equal(fs.statSync(receiptPath).mode & 0o777, 0o600);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.includes('.tmp-')),
    [],
  );
});

test('Telegram success without a message ID is rejected before a receipt is claimed', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-no-id-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const receiptPath = path.join(directory, 'delivery-receipts.json');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true, result: { chat: { id: -1001 } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1001',
      text: 'summary',
      receiptPath,
      receipt: { delivery: 'incremental_summary' },
    }),
    /without returning a valid result\.message_id/,
  );
  assert.equal(fs.existsSync(receiptPath), false);
});
