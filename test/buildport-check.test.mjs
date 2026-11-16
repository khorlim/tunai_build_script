import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { performBuild } from '../node/lib/build.mjs';
import { checkBuildNumber, splitVersion } from '../node/lib/buildport-check.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const base = {
  version: '2.0.0+386',
  platform: 'ios',
  appGroup: 'TunaiPro',
  apiToken: 'token',
  baseUrl: 'https://buildport.test/buildport',
};

test('splitVersion needs an explicit build number', () => {
  assert.deepEqual(splitVersion('2.0.0+386'), { version: '2.0.0', build: '386' });
  assert.equal(splitVersion('2.0.0'), null);
  assert.equal(splitVersion(null), null);
});

test('asks BuildPort with the app, platform, version and build', async () => {
  let seen;
  const result = await checkBuildNumber({
    ...base,
    fetchImpl: async (url, options) => {
      seen = { url: new URL(url), auth: options.headers.Authorization };
      return json({ taken: false, entries: [] });
    },
  });
  assert.equal(result.status, 'free');
  assert.equal(seen.url.pathname, '/buildport/api/builds/check');
  assert.equal(seen.url.searchParams.get('version'), '2.0.0');
  assert.equal(seen.url.searchParams.get('build'), '386');
  assert.equal(seen.url.searchParams.get('platform'), 'ios');
  assert.equal(seen.url.searchParams.get('app'), 'TunaiPro');
  assert.equal(seen.auth, 'Bearer token');
});

test('a taken number names the tracks and the way out', async () => {
  const result = await checkBuildNumber({
    ...base,
    fetchImpl: async () => json({
      taken: true,
      entries: [{ track: 'Main', uploaded_at: '2026-11-13T10:00:00Z' }, { track: 'Shift API 8080' }],
    }),
  });
  assert.equal(result.status, 'taken');
  assert.match(result.message, /2\.0\.0\+386 is already on BuildPort/);
  assert.match(result.message, /Main \(2026-11-13\), Shift API 8080/);
  assert.match(result.message, /--reserve --adhoc/);
});

test('only an answer blocks: offline, errors and unsupported platforms continue', async () => {
  const warnings = [];
  const warn = (message) => warnings.push(message);
  const offline = await checkBuildNumber({ ...base, warn, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const denied = await checkBuildNumber({ ...base, warn, fetchImpl: async () => json({ error: 'unauthorized' }, 401) });
  const macos = await checkBuildNumber({ ...base, platform: 'macos', warn, fetchImpl: async () => assert.fail('no request for macos') });
  const noToken = await checkBuildNumber({ ...base, apiToken: '', warn, fetchImpl: async () => assert.fail('no request without a token') });
  const noBuild = await checkBuildNumber({ ...base, version: '2.0.0', warn, fetchImpl: async () => assert.fail('no request without a build number') });
  for (const result of [offline, denied, macos, noToken, noBuild]) assert.equal(result.status, 'skipped');
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /HTTP 401/);
});

test('performBuild stops before building when the number is taken', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'pubspec.yaml'), 'name: demo\nversion: 2.0.0+386\n');
  const previousExit = process.exit;
  const previousError = console.error;
  const errors = [];
  process.exit = (code) => { throw new Error(`Exit ${code}`); };
  console.error = (...args) => errors.push(args.join(' '));
  t.after(() => { process.exit = previousExit; console.error = previousError; });
  let uploads = 0;
  let asked;
  await assert.rejects(performBuild({
    projectRoot: root,
    config: { buildport: { api_token: 'token' } },
    platform: 'ios',
    update: false,
    performUploadImpl: async () => { uploads += 1; },
    checkBuildNumberImpl: async (input) => {
      asked = input;
      return { status: 'taken', message: 'Build number 2.0.0+386 is already on BuildPort' };
    },
  }), /Exit 1/);
  assert.equal(uploads, 0);
  assert.equal(asked.version, '2.0.0+386');
  assert.equal(asked.appGroup, 'demo');
  assert.match(errors.join('\n'), /already on BuildPort/);
  assert.doesNotMatch(errors.join('\n'), /flutter build/);
});
