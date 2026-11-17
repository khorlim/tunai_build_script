import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { performBuild } from '../node/lib/build.mjs';
import { readDotEnvValue } from '../node/lib/release-candidate.mjs';
import {
  prepareChannelBuild,
  runChannelBuild,
} from '../node/lib/channel-build.mjs';

const cliPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'node',
  'bin',
  'tunai-build-script.mjs',
);

const haveTools =
  process.platform === 'darwin' &&
  !spawnSync('plutil', ['-help'], { stdio: 'ignore' }).error &&
  !spawnSync('zip', ['-v'], { stdio: 'ignore' }).error;

function exportPlist(profiles) {
  const entries = Object.entries(profiles)
    .map(([id, name]) => `    <key>${id}</key><string>${name}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>ad-hoc</string>
  <key>signingStyle</key><string>manual</string>
  <key>teamID</key><string>ABCDEFGHIJ</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
${entries}
  </dict>
</dict>
</plist>
`;
}

function makeProject({ profiles } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tunai-channel-'));
  fs.mkdirSync(path.join(root, 'ios', 'Flutter'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pubspec.yaml'), 'name: example\nversion: 1.0.0+7\n');
  fs.writeFileSync(path.join(root, '.env.tunai.defaults'), 'CONFIG_URL=https://config.example.test\n');
  fs.writeFileSync(
    path.join(root, 'ios', 'ExportOptions.test.plist'),
    exportPlist(profiles ?? { 'com.example.app.test': 'match AdHoc com.example.app.test' }),
  );
  fs.writeFileSync(
    path.join(root, 'ios', 'ExportOptions.prod.plist'),
    exportPlist({ 'com.example.app': 'match AdHoc com.example.app' }),
  );
  return root;
}

function channelConfig(overrides = {}) {
  return {
    upload: { provider: 'loadly' },
    buildport: { api_token: 'test-token', app_group: 'Example' },
    telegram: { bot_token: 'bot', chat_id: '-1' },
    channel: {
      test: {
        ios_bundle_id: 'com.example.app.test',
        ios_display_name: 'Example Test',
        ios_export_options_plist: 'ios/ExportOptions.test.plist',
        env_overrides: { TestVersion: 'true' },
      },
      prod: {
        ios_bundle_id: 'com.example.app',
        ios_display_name: 'Example',
        ios_export_options_plist: 'ios/ExportOptions.prod.plist',
        env_overrides: { TestVersion: 'false' },
      },
    },
    ...overrides,
  };
}

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

function makeFixtureIpa(dir, { bundleId, displayName, testVersion }) {
  const app = path.join(dir, 'Payload', 'Runner.app');
  const assets = path.join(app, 'Frameworks', 'App.framework', 'flutter_assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(
    path.join(app, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleDisplayName</key><string>${displayName}</string>
</dict></plist>
`,
  );
  fs.writeFileSync(path.join(assets, '.env'), `TestVersion=${testVersion}\n`);
  const ipa = path.join(dir, 'fixture.ipa');
  execFileSync('zip', ['-qr', ipa, 'Payload'], { cwd: dir });
  return ipa;
}

/**
 * Fake `flutter` and `git` on PATH. flutter records its args and the archive
 * signing xcconfig it was given, then drops a fixture IPA; git records any call.
 */
function installFakeTools(t, { ipa }) {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunai-channel-fake-'));
  const binDir = path.join(logDir, 'bin');
  fs.mkdirSync(binDir);
  fs.writeFileSync(
    path.join(binDir, 'flutter'),
    `#!/bin/sh
echo "$@" >> "$FAKE_LOG_DIR/flutter.log"
if [ -n "$XCODE_XCCONFIG_FILE" ]; then cat "$XCODE_XCCONFIG_FILE" > "$FAKE_LOG_DIR/xcconfig.txt"; fi
mkdir -p build/ios/ipa && cp "$FAKE_IPA" build/ios/ipa/app.ipa
exit 0
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(binDir, 'git'),
    '#!/bin/sh\necho "$@" >> "$FAKE_LOG_DIR/git.log"\nexit 0\n',
    { mode: 0o755 },
  );
  const saved = {
    PATH: process.env.PATH,
    FAKE_LOG_DIR: process.env.FAKE_LOG_DIR,
    FAKE_IPA: process.env.FAKE_IPA,
    XCODE_XCCONFIG_FILE: process.env.XCODE_XCCONFIG_FILE,
  };
  delete process.env.XCODE_XCCONFIG_FILE;
  process.env.PATH = `${binDir}:${saved.PATH}`;
  process.env.FAKE_LOG_DIR = logDir;
  process.env.FAKE_IPA = ipa;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(logDir, { recursive: true, force: true });
  });
  const read = (name) => {
    const p = path.join(logDir, name);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  return { read };
}

function stubbedBuild(uploads) {
  return (options) =>
    performBuild({
      ...options,
      checkBuildNumberImpl: async () => ({ status: 'free' }),
      performUploadImpl: async (upload) => {
        uploads.push(upload);
      },
    });
}

function runCli(args, cwd = os.tmpdir()) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', cwd });
}

for (const [channelName, bundleId, displayName, testVersion] of [
  ['test', 'com.example.app.test', 'Example Test', 'true'],
  ['prod', 'com.example.app', 'Example', 'false'],
]) {
  test(`channel ${channelName} is applied, built and uploaded with no git commands`, { skip: !haveTools }, async (t) => {
    const root = makeProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const ipa = makeFixtureIpa(
      fs.mkdtempSync(path.join(os.tmpdir(), 'tunai-channel-ipa-')),
      { bundleId, displayName, testVersion },
    );
    t.after(() => fs.rmSync(path.dirname(ipa), { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, '.env'), 'CONFIG_URL=https://example.test\nTestVersion=other\n');
    const fake = installFakeTools(t, { ipa });
    const before = listFiles(root);
    const pubspecBefore = fs.readFileSync(path.join(root, 'pubspec.yaml'), 'utf8');

    const lines = [];
    const uploads = [];
    const config = channelConfig();
    const originalLog = console.log;
    console.log = () => {};
    try {
      await runChannelBuild({
        projectRoot: root,
        config,
        channelName,
        update: false,
        notes: { text: 'branch notes', file: null },
        performBuildImpl: stubbedBuild(uploads),
        log: (line) => lines.push(line),
      });
    } finally {
      console.log = originalLog;
    }

    assert.ok(lines.includes(`Channel: ${channelName} bundle id ${bundleId}`), lines.join('\n'));
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    assert.equal(readDotEnvValue(env, 'TestVersion'), testVersion);
    const xcconfig = fs.readFileSync(path.join(root, 'ios', 'Flutter', 'channel.xcconfig'), 'utf8');
    assert.match(xcconfig, new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = ${bundleId.replaceAll('.', '\\.')}$`, 'm'));
    assert.match(xcconfig, new RegExp(`APP_DISPLAY_NAME = ${displayName}`));

    // Only the two ignored channel files are written, and the tool lists them.
    assert.deepEqual(
      listFiles(root).filter((f) => !before.includes(f) && !f.startsWith('build')),
      ['ios/Flutter/channel.xcconfig'],
    );
    assert.equal(fs.readFileSync(path.join(root, 'pubspec.yaml'), 'utf8'), pubspecBefore);
    assert.ok(lines.some((l) => l.trim() === path.join(root, '.env')));
    assert.ok(lines.some((l) => l.trim() === path.join(root, 'ios/Flutter/channel.xcconfig')));

    // No git at all, with no pull/update and no commit, tag or push.
    assert.equal(fake.read('git.log'), null);
    assert.match(fake.read('flutter.log'), /^build ipa --export-options-plist .*ExportOptions\.(test|prod)\.plist$/m);

    // Manual archive signing was applied through the xcconfig override.
    const signing = fake.read('xcconfig.txt');
    assert.match(signing, /CODE_SIGN_STYLE = Manual/);
    assert.match(signing, new RegExp(`TUNAI_ARCHIVE_PROFILE_Runner = match AdHoc ${bundleId.replaceAll('.', '\\.')}`));

    // BuildPort only: Telegram is stripped and notes pass through.
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].config.telegram, undefined);
    assert.equal(uploads[0].config.upload.provider, 'buildport');
    assert.equal(uploads[0].notes.text, 'branch notes');
    assert.equal(uploads[0].changelogRelativePath, null);
  });
}

test('channel build fails when the built IPA carries the wrong channel', { skip: !haveTools }, async (t) => {
  const root = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ipa = makeFixtureIpa(fs.mkdtempSync(path.join(os.tmpdir(), 'tunai-channel-ipa-')), {
    bundleId: 'com.example.app',
    displayName: 'Example',
    testVersion: 'false',
  });
  t.after(() => fs.rmSync(path.dirname(ipa), { recursive: true, force: true }));
  installFakeTools(t, { ipa });
  const uploads = [];
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  process.exit = (code) => {
    throw new Error(`exit ${code}`);
  };
  console.log = () => {};
  console.error = () => {};
  try {
    await assert.rejects(
      runChannelBuild({
        projectRoot: root,
        config: channelConfig(),
        channelName: 'test',
        update: false,
        performBuildImpl: stubbedBuild(uploads),
        log: () => {},
      }),
      /exit 1/,
    );
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }
  assert.equal(uploads.length, 0);
});

test('extension targets get their own archive signing profile', { skip: !haveTools }, (t) => {
  const root = makeProject({
    profiles: {
      'com.example.app.test': 'match AdHoc com.example.app.test',
      'com.example.app.test.widget': 'match AdHoc widget',
    },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = channelConfig();
  config.channel.test.ios_extension_targets = {
    'com.example.app.test.widget': 'WidgetExtension',
  };
  const result = prepareChannelBuild({ projectRoot: root, config, channelName: 'test' });
  const { additionalTargets, ...mainTarget } = result.archiveSigning;
  assert.deepEqual(mainTarget, {
    target: 'Runner',
    teamId: 'ABCDEFGHIJ',
    certificate: 'Apple Distribution',
    profile: 'match AdHoc com.example.app.test',
  });
  assert.deepEqual({ ...additionalTargets }, { WidgetExtension: 'match AdHoc widget' });

  // An exported extension without a target mapping fails before any file is written.
  const unmapped = makeProject({
    profiles: {
      'com.example.app.test': 'match AdHoc com.example.app.test',
      'com.example.app.test.widget': 'match AdHoc widget',
    },
  });
  t.after(() => fs.rmSync(unmapped, { recursive: true, force: true }));
  assert.throws(
    () => prepareChannelBuild({ projectRoot: unmapped, config: channelConfig(), channelName: 'test' }),
    /No Xcode target mapping for exported extension com\.example\.app\.test\.widget/,
  );
  assert.deepEqual(listFiles(unmapped).filter((f) => f.endsWith('channel.xcconfig') || f === '.env'), []);
});

test('export options must map the channel bundle id', { skip: !haveTools }, (t) => {
  const root = makeProject({ profiles: { 'com.example.other': 'match AdHoc other' } });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => prepareChannelBuild({ projectRoot: root, config: channelConfig(), channelName: 'test' }),
    /must map a provisioning profile for com\.example\.app\.test/,
  );
  assert.equal(fs.existsSync(path.join(root, 'ios', 'Flutter', 'channel.xcconfig')), false);
});

test('missing channel fails clearly', (t) => {
  const root = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = channelConfig();
  delete config.channel.prod;
  assert.throws(
    () => prepareChannelBuild({ projectRoot: root, config, channelName: 'prod' }),
    /channel\.prod is required for --channel/,
  );
  const configPath = path.join(root, 'tunai_build_script_config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const result = runCli(['--platform', 'ios', '--channel', 'prod', '--no-update', '--config', configPath, '--project-root', root]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /channel\.prod is required for --channel/);
  assert.equal(fs.existsSync(path.join(root, '.env')), false);
});

test('--channel dry run validates and writes nothing', { skip: !haveTools }, (t) => {
  const root = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'tunai_build_script_config.json');
  fs.writeFileSync(configPath, JSON.stringify(channelConfig()));
  const before = listFiles(root);
  const result = runCli([
    '--platform', 'ios', '--channel', 'test', '--no-update', '--dry-run', '--track', 'Branch',
    '--notes-file', 'notes.md', '--config', configPath, '--project-root', root,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Channel: test bundle id com\.example\.app\.test$/m);
  assert.deepEqual(listFiles(root), before);
});

test('--channel rejects bad flag combinations', () => {
  const cases = [
    [['--channel', 'beta', '--platform', 'ios'], /--channel requires test or prod/],
    [['--channel'], /--channel requires test or prod/],
    [['--channel', 'test'], /--channel requires --platform ios/],
    [['--channel', 'test', '--platform', 'android'], /ios only/],
    [['--channel', 'test', '--platform', 'macos'], /not supported with --platform macos/],
    [['--channel', 'test', '--platform', 'ios', '--upload'], /do not use --upload/],
    [['--channel', 'test', '--release-candidate', 'ios'], /--release-candidate/],
    [['--channel', 'test', '--platform', 'ios', '--test-release', 'ios'], /--test-release/],
    [['--channel', 'test', '--prepare-release', 'patch'], /--prepare-release/],
    [['--channel', 'test', '--bump-version', 'manual', '1.2.3+4'], /--bump-version/],
    [['--channel', 'test', '--platform', 'ios', '--telegram-receipt', '/tmp/r.json'], /sends nothing to Telegram/],
    [['--channel', 'test', '--platform', 'ios', '--topic-id', '5'], /sends nothing to Telegram/],
    [['--channel', 'test', '--platform', 'ios', '--tag-prefix', 'x'], /does not tag/],
  ];
  for (const [args, pattern] of cases) {
    const result = runCli(args);
    assert.notEqual(result.status, 0, args.join(' '));
    assert.match(result.stderr, pattern, args.join(' '));
  }
});

test('--help documents --channel', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--channel test\|prod/);
});
