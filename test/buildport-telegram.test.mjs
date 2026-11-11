import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBuildportUploadMessage, notesToTelegram } from '../node/lib/buildport-telegram.mjs';

const url = 'https://support.tunai.io/buildport/a/abc/t/walkie';

test('BuildPort upload message shows the app, track and release notes', () => {
  const text = formatBuildportUploadMessage({
    platform: 'ios',
    version: '1.3.10+107',
    fallbackAppName: 'tunai_staff',
    upload: {
      url,
      response: {
        app_name: 'TunaiStaff',
        release_version: '1.3.10+107',
        track: { name: 'Walkie', slug: 'walkie', url },
        notes: "## What's new\n- Push to talk on the **lock screen** ([#420](https://github.com/o/r/pull/420))\n\n## What to test\n1. Hold the <button> while locked",
      },
    },
  });

  assert.equal(text, [
    '✅ <b>TunaiStaff 1.3.10+107</b> is ready to test',
    'iOS · Track: <b>Walkie</b>',
    '',
    "<b>What's new</b>",
    '• Push to talk on the <b>lock screen</b> (<a href="https://github.com/o/r/pull/420">#420</a>)',
    '',
    '<b>What to test</b>',
    '1. Hold the &lt;button&gt; while locked',
    '',
    '📲 <b>Install</b>',
    url,
  ].join('\n'));
});

test('BuildPort upload message without notes is just the header and link', () => {
  const text = formatBuildportUploadMessage({
    platform: 'android',
    version: '2.0.0+5',
    fallbackAppName: 'tunai_app',
    upload: { url: 'https://support.tunai.io/buildport/a/xyz', response: { app_name: 'TunaiApp' } },
  });
  assert.equal(text, [
    '✅ <b>TunaiApp 2.0.0+5</b> is ready to test',
    'Android',
    '',
    '📲 <b>Install</b>',
    'https://support.tunai.io/buildport/a/xyz',
  ].join('\n'));
});

test('long notes are cut at a line and point to the install page', () => {
  const notes = Array.from({ length: 200 }, (_, index) => `- Change number ${index + 1}`).join('\n');
  const result = notesToTelegram(notes, 200);
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 200);
  assert.match(result.text, /^• Change number 1\n/);
  const text = formatBuildportUploadMessage({ platform: 'ios', version: '1', upload: { url, response: { notes } } });
  assert.match(text, /…more on the install page\n\n📲/);
  assert.ok(text.length < 4096);
});
