import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { performUpload } from '../node/lib/build.mjs';

// Fully mocked fetch: the first response stands in for Buildport, the second
// rejects at Telegram's post-upload notification boundary. No external send.
test('post-upload Telegram transport failure reports safe cause and never replays ambiguous POST', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'build-notification-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectRoot, 'pubspec.yaml'), 'name: demo\nversion: 1.0.189+331\n');
  const buildFilePath = path.join(projectRoot, 'fixture.ipa');
  fs.writeFileSync(buildFilePath, 'fixture');
  const telegramReceiptPath = path.join(projectRoot, 'telegram-delivery.json');
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const previousError = console.error;
  const output = [];
  const calls = [];
  console.log = (...args) => output.push(args);
  console.error = (...args) => output.push(args);
  globalThis.fetch = async (url) => {
    calls.push(String(url).includes('buildport') ? 'buildport' : 'telegram');
    if (calls.length === 1) {
      return new Response(JSON.stringify({ url: 'https://example.invalid/install' }), { status: 200 });
    }
    const cause = Object.assign(
      new Error('request https://api.telegram.org/botSECRET_BOT_TOKEN/sendMessage PRIVATE_PAYLOAD'),
      { code: 'ECONNRESET' },
    );
    throw new TypeError('fetch failed', { cause });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    console.error = previousError;
  });

  const config = {
    upload: { provider: 'buildport' },
    buildport: { api_token: 'SECRET_BUILDPORT_TOKEN', timeout_seconds: 60 },
    telegram: { bot_token: 'SECRET_BOT_TOKEN', chat_id: '-1001' },
  };
  let thrown;
  await assert.rejects(performUpload({
    projectRoot, config, platform: 'ios', buildFilePath, telegramReceiptPath,
  }), (error) => {
    thrown = error;
    assert.match(error.message, /Telegram build upload notification transport failed/);
    return true;
  });
  const rendered = JSON.stringify(output) + String(thrown.message);
  assert.deepEqual(calls, ['buildport', 'telegram']);
  assert.match(rendered, /ECONNRESET/);
  assert.doesNotMatch(rendered, /SECRET_BOT_TOKEN|SECRET_BUILDPORT_TOKEN|PRIVATE_PAYLOAD|https:\/\/api\.telegram\.org\/bot/);
  assert.equal(fs.existsSync(telegramReceiptPath), false);
});
