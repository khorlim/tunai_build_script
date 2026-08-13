import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyDotEnvOverrides,
  prepareChannelEnvironment,
  prepareReleaseCandidate,
  readDotEnvValue,
  validateIosReleaseCandidateArtifact,
} from '../node/lib/release-candidate.mjs';
import { runPrepareRelease } from '../node/lib/prepare-release.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const cliPath = path.join(
  repoRoot,
  'node',
  'bin',
  'tunai-build-script.mjs',
);

function makeTempProject() {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tunai-release-candidate-'),
  );
  fs.mkdirSync(path.join(projectRoot, 'ios', 'Flutter'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(projectRoot, 'pubspec.yaml'),
    'name: example\nversion: 1.0.0+1\n',
  );
  fs.writeFileSync(
    path.join(projectRoot, '.env.tunai.defaults'),
    'CONFIG_URL=https://config.example.test\n',
  );
  fs.writeFileSync(
    path.join(projectRoot, 'ios', 'ExportOptions.prod-adhoc.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>ad-hoc</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>com.example.app</key>
    <string>match AdHoc com.example.app</string>
  </dict>
</dict>
</plist>
`,
  );
  return projectRoot;
}

function candidateConfig() {
  return {
    upload: { provider: 'apphost' },
    buildport: {
      api_token: 'test-token',
      app_group: 'Example',
    },
    release_candidate: {
      tag_prefix: 'example-rc',
    },
    channel: {
      prod: {
        ios_bundle_id: 'com.example.app',
        ios_display_name: 'Example',
        ios_export_options_plist:
          'ios/ExportOptions.prod-adhoc.plist',
        env_overrides: {
          TestVersion: 'false',
        },
      },
    },
  };
}

function runGit(projectRoot, args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test('dotenv overrides replace existing values and append missing values', () => {
  const result = applyDotEnvOverrides(
    'CONFIG_URL=https://example.test\nTestVersion=true\n',
    {
      TestVersion: 'false',
      ENV: 'production',
    },
  );

  assert.equal(readDotEnvValue(result, 'TestVersion'), 'false');
  assert.equal(readDotEnvValue(result, 'ENV'), 'production');
  assert.match(result, /CONFIG_URL=https:\/\/example\.test/);
});

test('release candidate writes production channel and forces Buildport', (t) => {
  const projectRoot = makeTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(projectRoot, '.env'),
    'CONFIG_URL=https://example.test\nTestVersion=true\n',
  );

  const result = prepareReleaseCandidate({
    projectRoot,
    config: candidateConfig(),
    platform: 'ios',
  });

  assert.equal(result.iosBundleId, 'com.example.app');
  assert.equal(result.tagPrefix, 'example-rc');
  assert.equal(result.buildportAppGroup, 'Example');
  assert.equal(result.config.upload.provider, 'buildport');
  assert.equal(result.config.upload.providers.ios, 'buildport');
  assert.equal(
    result.config.ios.export_options_plist,
    'ios/ExportOptions.prod-adhoc.plist',
  );
  assert.equal(
    readDotEnvValue(
      fs.readFileSync(path.join(projectRoot, '.env'), 'utf8'),
      'TestVersion',
    ),
    'false',
  );
  assert.match(
    fs.readFileSync(
      path.join(projectRoot, 'ios', 'Flutter', 'channel.xcconfig'),
      'utf8',
    ),
    /PRODUCT_BUNDLE_IDENTIFIER = com\.example\.app/,
  );
  assert.match(
    fs.readFileSync(
      path.join(projectRoot, 'ios', 'Flutter', 'channel.xcconfig'),
      'utf8',
    ),
    /APP_DISPLAY_NAME = Example/,
  );
});

test('release candidate validates a cumulative production changelog destination', (t) => {
  const projectRoot = makeTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const config = candidateConfig();
  config.telegram = {
    bot_token: 'test-bot-token',
    chat_id: '-1001',
    topic_id: '20',
    changelog_summary: {
      enabled: true,
      provider: 'claude_cli',
      model: 'haiku',
      max_chars: 3000,
      timeout_seconds: 240,
      failure_mode: 'warn',
    },
  };
  config.release_candidate.cumulative_changelog = {
    from_tag_prefix: 'example-prod',
    path: 'changelog_tester_since_prod.md',
    telegram: {
      chat_id: '-1002',
      topic_id: '30',
    },
  };

  const result = prepareReleaseCandidate({
    projectRoot,
    config,
    platform: 'ios',
    writeFiles: false,
  });

  assert.deepEqual(result.cumulativeChangelog, {
    fromTagPrefix: 'example-prod',
    outputPath: 'changelog_tester_since_prod.md',
    telegram: {
      bot_token: 'test-bot-token',
      chat_id: '-1002',
      topic_id: '30',
    },
  });
});

test('cumulative changelog rejects unsafe paths and missing summaries', (t) => {
  const projectRoot = makeTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const config = candidateConfig();
  config.telegram = {
    bot_token: 'test-bot-token',
    chat_id: '-1001',
  };
  config.release_candidate.cumulative_changelog = {
    from_tag_prefix: 'example-prod',
    path: '../outside.md',
    telegram: {
      chat_id: '-1002',
      topic_id: '30',
    },
  };

  assert.throws(
    () =>
      prepareReleaseCandidate({
        projectRoot,
        config,
        platform: 'ios',
        writeFiles: false,
      }),
    /project-relative Markdown path/,
  );

  config.release_candidate.cumulative_changelog.path =
    'changelog_tester_since_prod.md';
  assert.throws(
    () =>
      prepareReleaseCandidate({
        projectRoot,
        config,
        platform: 'ios',
        writeFiles: false,
      }),
    /changelog_summary.enabled=true/,
  );
});

test('prepare release commits the cumulative tester changelog', async (t) => {
  const projectRoot = makeTempProject();
  const remoteRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tunai-release-candidate-remote-'),
  );
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(remoteRoot, { recursive: true, force: true }));

  runGit(projectRoot, ['init', '-b', 'main']);
  runGit(projectRoot, ['config', 'user.name', 'Release Test']);
  runGit(projectRoot, ['config', 'user.email', 'release@example.test']);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['commit', '-m', 'chore: initial release']);
  runGit(projectRoot, ['tag', 'example-prod-v1.0.0+1']);
  runGit(projectRoot, ['tag', 'example-rc-v1.0.0+1']);

  fs.writeFileSync(
    path.join(projectRoot, 'feature.txt'),
    'customer-visible report export\n',
  );
  runGit(projectRoot, ['add', 'feature.txt']);
  runGit(projectRoot, [
    'commit',
    '-m',
    'feat(reports): add export (#1)',
  ]);

  execFileSync('git', ['init', '--bare', remoteRoot], {
    stdio: 'ignore',
  });
  runGit(projectRoot, ['remote', 'add', 'origin', remoteRoot]);
  runGit(projectRoot, ['push', '-u', 'origin', 'main', '--tags']);

  const result = await runPrepareRelease({
    projectRoot,
    bumpType: 'build',
    changelogFrom: 'example-rc-v1.0.0+1',
    changelogTo: 'HEAD',
    tagPrefix: 'example-rc',
    supplementalTesterChangelog: {
      fromRev: 'example-prod-v1.0.0+1',
      outputPath: 'changelog_tester_since_prod.md',
    },
  });

  assert.equal(result.newVersion, '1.0.0+2');
  assert.equal(
    result.supplementalTesterChangelog.fromRev,
    'example-prod-v1.0.0+1',
  );
  const cumulative = runGit(projectRoot, [
    'show',
    'HEAD:changelog_tester_since_prod.md',
  ]);
  assert.match(cumulative, /Release v1\.0\.0\+2/);
  assert.match(cumulative, /example-prod-v1\.0\.0\+1/);
  assert.match(cumulative, /### Merged PRs/);
  assert.equal(runGit(projectRoot, ['status', '--porcelain']), '');
});

test('test channel writes an explicit test environment', (t) => {
  const projectRoot = makeTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectRoot, '.env'), 'TestVersion=false\n');

  const result = prepareChannelEnvironment({
    projectRoot,
    channel: {
      env_overrides: {
        TestVersion: 'true',
      },
    },
    channelName: 'test',
    expectedTestVersion: true,
  });

  assert.equal(result.testVersion, 'true');
  assert.equal(
    readDotEnvValue(
      fs.readFileSync(path.join(projectRoot, '.env'), 'utf8'),
      'TestVersion',
    ),
    'true',
  );
});

test('channel preparation refuses TestVersion in shared defaults', (t) => {
  const projectRoot = makeTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(projectRoot, '.env.tunai.defaults'),
    'TestVersion=true\n',
  );

  assert.throws(
    () =>
      prepareReleaseCandidate({
        projectRoot,
        config: candidateConfig(),
        platform: 'ios',
      }),
    /.env.tunai.defaults must not define TestVersion/,
  );
});

test('release candidate refuses a non-production TestVersion', (t) => {
  const projectRoot = makeTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const config = candidateConfig();
  config.channel.prod.env_overrides.TestVersion = 'true';

  assert.throws(
    () =>
      prepareReleaseCandidate({
        projectRoot,
        config,
        platform: 'ios',
      }),
    /TestVersion must be "false"/,
  );
});

test('release-candidate dry-run needs no git branch or repository', (t) => {
  const projectRoot = makeTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const configPath = path.join(
    projectRoot,
    'tunai_build_script_config.json',
  );
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(candidateConfig(), null, 2)}\n`,
  );

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      '--release-candidate',
      'ios',
      '--dry-run',
      '--project-root',
      projectRoot,
      '--config',
      configPath,
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Channel: production/);
  assert.match(result.stdout, /Distribution: Buildport/);
  assert.equal(fs.existsSync(path.join(projectRoot, '.env')), false);
});

test('test-release dry-run validates test env without writing it', (t) => {
  const projectRoot = makeTempProject();
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const config = candidateConfig();
  config.channel.test = {
    ios_bundle_id: 'com.example.app.test',
    ios_display_name: 'Example Test',
    env_overrides: {
      TestVersion: 'true',
    },
  };
  const configPath = path.join(
    projectRoot,
    'tunai_build_script_config.json',
  );
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      '--test-release',
      'ios',
      '--dry-run',
      '--project-root',
      projectRoot,
      '--config',
      configPath,
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Channel environment: TestVersion=true/);
  assert.equal(fs.existsSync(path.join(projectRoot, '.env')), false);
  assert.equal(
    fs.existsSync(
      path.join(projectRoot, 'ios', 'Flutter', 'channel.xcconfig'),
    ),
    false,
  );
});

test('IPA validation checks production bundle id and packaged env', (t) => {
  const zipCheck = spawnSync('zip', ['-v'], { stdio: 'ignore' });
  const plistCheck = spawnSync('plutil', ['-help'], { stdio: 'ignore' });
  if (zipCheck.error || plistCheck.error) {
    t.skip('zip and plutil are required for IPA validation');
    return;
  }

  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tunai-release-candidate-ipa-'),
  );
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const appRoot = path.join(projectRoot, 'Payload', 'Runner.app');
  const flutterAssets = path.join(
    appRoot,
    'Frameworks',
    'App.framework',
    'flutter_assets',
  );
  fs.mkdirSync(flutterAssets, { recursive: true });
  fs.writeFileSync(
    path.join(appRoot, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.app</string>
  <key>CFBundleDisplayName</key>
  <string>Example</string>
</dict>
</plist>
`,
  );
  fs.writeFileSync(
    path.join(flutterAssets, '.env'),
    'TestVersion=false\n',
  );
  const defaultsPath = path.join(flutterAssets, '.env.tunai.defaults');
  fs.writeFileSync(
    defaultsPath,
    'CONFIG_URL=https://config.example.test\n',
  );
  const ipaPath = path.join(projectRoot, 'example.ipa');
  execFileSync('zip', ['-qr', ipaPath, 'Payload'], {
    cwd: projectRoot,
  });

  assert.deepEqual(
    validateIosReleaseCandidateArtifact({
      ipaPath,
      expectedBundleId: 'com.example.app',
      expectedDisplayName: 'Example',
    }),
    {
      bundleId: 'com.example.app',
      displayName: 'Example',
      testVersion: 'false',
    },
  );
  assert.throws(
    () =>
      validateIosReleaseCandidateArtifact({
        ipaPath,
        expectedBundleId: 'com.example.other',
        expectedDisplayName: 'Example',
      }),
    /expected "com\.example\.other"/,
  );

  fs.writeFileSync(defaultsPath, 'TestVersion=true\n');
  execFileSync(
    'zip',
    ['-q', ipaPath, path.relative(projectRoot, defaultsPath)],
    { cwd: projectRoot },
  );
  assert.throws(
    () =>
      validateIosReleaseCandidateArtifact({
        ipaPath,
        expectedBundleId: 'com.example.app',
        expectedDisplayName: 'Example',
      }),
    /defaults must not define TestVersion/,
  );
});
