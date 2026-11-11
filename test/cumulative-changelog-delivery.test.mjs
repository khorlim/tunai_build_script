import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deliverTelegramChangelog } from '../node/lib/build.mjs';

test('cumulative changelog document uses the separate Telegram destination', async (t) => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tunai-cumulative-changelog-'),
  );
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const changelogRelativePath = 'changelog_tester_since_prod.md';
  const changelogFile = path.join(projectRoot, changelogRelativePath);
  const receiptPath = path.join(projectRoot, 'telegram-delivery.json');
  fs.writeFileSync(changelogFile, '# Tester changelog\n', 'utf8');

  const calls = [];
  const delivered = await deliverTelegramChangelog({
    projectRoot,
    changelogRelativePath,
    telegram: {
      bot_token: 'bot-token',
      chat_id: '-1002170888660',
      topic_id: '14332',
    },
    appName: 'TunaiPro',
    platform: 'ios',
    version: '1.0.184+284',
    label: 'cumulative changelog',
    documentTitle: 'Full changelog since production',
    receiptPath,
    receiptPrefix: 'cumulative',
    sendDocumentImpl: async (args) => {
      calls.push(args);
      return true;
    },
  });

  assert.equal(delivered, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, '-1002170888660');
  assert.equal(calls[0].topicId, '14332');
  assert.equal(calls[0].filePath, changelogFile);
  assert.match(calls[0].caption, /Full changelog since production/);
  assert.equal(calls[0].receiptPath, receiptPath);
  assert.deepEqual(calls[0].receipt, {
    delivery: 'cumulative_document',
    version: '1.0.184+284',
  });
});

test('receipt-backed changelog delivery stops when Telegram rejects the document', async (t) => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tunai-strict-telegram-receipt-'),
  );
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(projectRoot, 'changelog_tester.md'),
    '# Tester changelog\n',
    'utf8',
  );

  await assert.rejects(
    deliverTelegramChangelog({
      projectRoot,
      changelogRelativePath: 'changelog_tester.md',
      telegram: { bot_token: 'bot-token', chat_id: '-1001', topic_id: '77' },
      appName: 'TunaiPro',
      platform: 'ios',
      version: '1.0.189+327',
      receiptPath: path.join(projectRoot, 'telegram-delivery.json'),
      sendDocumentImpl: async () => false,
    }),
    /Telegram rejected the changelog document/,
  );
});
