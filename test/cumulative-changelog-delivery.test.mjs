import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deliverTelegramChangelog } from '../node/lib/build.mjs';

test('cumulative summary and document use the separate Telegram destination', async (t) => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tunai-cumulative-changelog-'),
  );
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const changelogRelativePath = 'changelog_tester_since_prod.md';
  const changelogFile = path.join(projectRoot, changelogRelativePath);
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
    generateSummaryImpl: async (args) => {
      calls.push({ type: 'summary', args });
      return 'full summary';
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
  assert.deepEqual(
    {
      chatId: calls[1].args.chatId,
      topicId: calls[1].args.topicId,
      text: calls[1].args.text,
    },
    {
      chatId: '-1002170888660',
      topicId: '14332',
      text: 'full summary',
    },
  );
  assert.equal(calls[2].args.chatId, '-1002170888660');
  assert.equal(calls[2].args.topicId, '14332');
  assert.equal(calls[2].args.filePath, changelogFile);
  assert.match(calls[2].args.caption, /Full changelog since production/);
});
