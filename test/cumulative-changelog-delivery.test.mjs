import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deliverTelegramChangelog } from '../node/lib/build.mjs';
import { ChangelogTooLargeError } from '../node/lib/changelog-summary.mjs';

test('cumulative summary and document use the separate Telegram destination', async (t) => {
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
    summaryConfig: {
      model: 'haiku',
      max_chars: 3000,
      timeout_seconds: 240,
    },
    appName: 'TunaiPro',
    platform: 'ios',
    version: '1.0.184+284',
    previousVersion: '1.0.183+277',
    label: 'cumulative changelog',
    summaryTitle: 'Full Release Summary',
    documentTitle: 'Full changelog since production',
    receiptPath,
    receiptPrefix: 'cumulative',
    generateSummaryImpl: async (args) => {
      calls.push({ type: 'summary', args });
      return ['full summary part 1', 'full summary part 2'];
    },
    sendMessageImpl: async (args) => {
      calls.push({ type: 'message', args });
      return true;
    },
    sendDocumentImpl: async (args) => {
      calls.push({ type: 'document', args });
      return true;
    },
  });

  assert.equal(delivered, true);
  assert.equal(calls[0].args.title, 'Full Release Summary');
  assert.equal(calls[0].args.previousVersion, '1.0.183+277');
  assert.equal(calls[1].args.receiptPath, receiptPath);
  assert.deepEqual(calls[1].args.receipt, {
    delivery: 'cumulative_summary',
    part: 1,
    total_parts: 2,
    version: '1.0.184+284',
  });
  assert.deepEqual(calls[2].args.receipt, {
    delivery: 'cumulative_summary',
    part: 2,
    total_parts: 2,
    version: '1.0.184+284',
  });
  assert.deepEqual(
    {
      chatId: calls[1].args.chatId,
      topicId: calls[1].args.topicId,
      text: calls[1].args.text,
    },
    {
      chatId: '-1002170888660',
      topicId: '14332',
      text: 'full summary part 1',
    },
  );
  assert.deepEqual(
    {
      chatId: calls[2].args.chatId,
      topicId: calls[2].args.topicId,
      text: calls[2].args.text,
    },
    {
      chatId: '-1002170888660',
      topicId: '14332',
      text: 'full summary part 2',
    },
  );
  assert.equal(calls[3].args.chatId, '-1002170888660');
  assert.equal(calls[3].args.topicId, '14332');
  assert.equal(calls[3].args.filePath, changelogFile);
  assert.match(calls[3].args.caption, /Full changelog since production/);
  assert.equal(calls[3].args.receiptPath, receiptPath);
  assert.deepEqual(calls[3].args.receipt, {
    delivery: 'cumulative_document',
    version: '1.0.184+284',
  });
});

test('receipt-backed changelog delivery stops when summary evidence cannot be persisted', async (t) => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tunai-strict-telegram-receipt-'),
  );
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(projectRoot, 'changelog_tester.md'),
    '# Tester changelog\n',
    'utf8',
  );
  let documentCalls = 0;
  const receiptError = new Error(
    'Telegram delivered message_id=17912, but its receipt could not be persisted',
  );

  await assert.rejects(
    deliverTelegramChangelog({
      projectRoot,
      changelogRelativePath: 'changelog_tester.md',
      telegram: {
        bot_token: 'bot-token',
        chat_id: '-1001',
        topic_id: '77',
      },
      summaryConfig: { model: 'haiku' },
      appName: 'TunaiPro',
      platform: 'ios',
      version: '1.0.189+327',
      receiptPath: path.join(projectRoot, 'telegram-delivery.json'),
      generateSummaryImpl: async () => ['summary'],
      sendMessageImpl: async () => {
        throw receiptError;
      },
      sendDocumentImpl: async () => {
        documentCalls += 1;
        return true;
      },
    }),
    (error) => {
      assert.equal(error.cause, undefined);
      assert.match(error.message, /summary part 1 send/);
      assert.doesNotMatch(error.message, /message_id=17912/);
      return true;
    },
  );
  assert.equal(documentCalls, 0);
});

test('a changelog too large to summarize sends the document and records the skip', async (t) => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tunai-summary-skipped-'),
  );
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const changelogRelativePath = 'changelog_tester_since_prod.md';
  const receiptPath = path.join(projectRoot, 'telegram-delivery.json');
  fs.writeFileSync(
    path.join(projectRoot, changelogRelativePath),
    '# Tester changelog\n',
    'utf8',
  );

  const calls = [];
  const delivered = await deliverTelegramChangelog({
    projectRoot,
    changelogRelativePath,
    telegram: { bot_token: 'bot-token', chat_id: '-1002170888660', topic_id: '14332' },
    summaryConfig: { model: 'haiku', max_chars: 3000, timeout_seconds: 240, max_source_chars: 180000 },
    appName: 'TunaiPro',
    platform: 'ios',
    version: '2.0.0+377',
    previousVersion: '1.0.192+362',
    label: 'cumulative changelog',
    receiptPath,
    receiptPrefix: 'cumulative',
    generateSummaryImpl: async () => {
      throw new ChangelogTooLargeError({ sourceChars: 447340, limit: 180000 });
    },
    sendMessageImpl: async (args) => {
      calls.push({ type: 'message', args });
      return true;
    },
    sendDocumentImpl: async (args) => {
      calls.push({ type: 'document', args });
      return true;
    },
  });

  assert.equal(delivered, true);
  assert.deepEqual(
    calls.map((call) => call.type),
    ['document'],
  );
  assert.equal(calls[0].args.receipt.delivery, 'cumulative_document');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.schema, 1);
  assert.equal(receipt.deliveries.length, 1);
  const [skipped] = receipt.deliveries;
  assert.equal(skipped.delivery, 'cumulative_summary_skipped');
  assert.equal(skipped.kind, 'skipped');
  assert.equal(skipped.reason, 'changelog_too_large');
  assert.equal(skipped.source_chars, 447340);
  assert.equal(skipped.limit_chars, 180000);
  assert.equal(skipped.version, '2.0.0+377');
  assert.equal('message_id' in skipped, false);
});

test('any other summary failure still stops a receipt-backed delivery', async (t) => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tunai-summary-other-failure-'),
  );
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectRoot, 'changelog.md'), '# Changelog\n', 'utf8');
  const documents = [];
  await assert.rejects(
    deliverTelegramChangelog({
      projectRoot,
      changelogRelativePath: 'changelog.md',
      telegram: { bot_token: 'bot-token', chat_id: '-1', topic_id: '1' },
      summaryConfig: { model: 'haiku', max_chars: 3000, timeout_seconds: 60 },
      appName: 'TunaiPro',
      platform: 'ios',
      version: '2.0.0+377',
      receiptPath: path.join(projectRoot, 'telegram-delivery.json'),
      generateSummaryImpl: async () => {
        throw new Error('claude exited with status 1');
      },
      sendMessageImpl: async () => true,
      sendDocumentImpl: async (args) => documents.push(args),
    }),
    /AI changelog summary delivery failed/,
  );
  assert.equal(documents.length, 0);
});
