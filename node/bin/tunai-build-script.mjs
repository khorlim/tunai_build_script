#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { findProjectWithConfig, CONFIG_FILENAME } from '../lib/find-project.mjs';
import {
  loadConfigFile,
  getPrepareReleaseSection,
  getTelegramChangelogSummarySection,
  getTelegramSection,
} from '../lib/config.mjs';
import { detectPlatform } from '../lib/platform-detect.mjs';
import { performBuild, performUpload } from '../lib/build.mjs';
import { sendTelegramMessage, sendTelegramDocument } from '../lib/telegram.mjs';
import { getAppInfo } from '../lib/app-info.mjs';
import { getVersion } from '../lib/pubspec.mjs';
import { generateChangelogSummary } from '../lib/changelog-summary.mjs';
import { bumpVersion } from '../lib/bump.mjs';
import { runMacosTestflightScript } from '../lib/macos-testflight.mjs';
import { runPrepareRelease } from '../lib/prepare-release.mjs';
import { getLastTagMatchingPrefix } from '../lib/changelog/changelog-git.mjs';
import {
  prepareChannelEnvironment,
  prepareReleaseCandidate,
  validateIosReleaseCandidateArtifact,
} from '../lib/release-candidate.mjs';

const BUMP_TYPES = new Set(['major', 'minor', 'patch', 'build', 'manual']);

function versionFromPrefixedTag(tag, prefix) {
  const marker = `${prefix.trim()}-v`;
  return tag.startsWith(marker) ? tag.slice(marker.length) : tag;
}

function usage() {
  console.log(`Usage: tunai-build-script [options]

  Config: ${CONFIG_FILENAME} is resolved from cwd or a parent, or pass --config <path>. Not required for
  --bump-version, --prepare-release (needs pubspec.yaml + git), --platform macos (needs macos/ or --project-root),
  or --generate-changelog.

Options:
  --config <path>               Config JSON file (absolute or relative). Paths inside config are relative to
                                --project-root or the discovered Flutter app root (pubspec.yaml).
  --platform ios|android|macos   iOS/Android: build & upload (apphost/buildport/loadly/telegram_apk via config). macos: TestFlight script.
  --bump-version <type> [ver]   major | minor | patch | build | manual (manual needs e.g. 1.2.3+5)
  --prepare-release <type> [ver]  Bump (always includes build #), changelog, commit, push, tag, push tag
  --test-release ios|android    One-liner testing build: channel switch (channel.test in config), build-number
                                bump, scoped changelog, commit+tag+push, then build & upload. --dry-run previews.
  --release-candidate ios       One-liner final testing build: channel.prod + production bundle/config, build-number
                                bump, scoped changelog, RC commit+tag+push, verified IPA, then Buildport upload.
  --tag-prefix <prefix>         With --prepare-release/--release-candidate: override the configured tag prefix
  --changelog-from <rev>        With --prepare-release: changelog start (default: prefix-matching tag or latest tag)
  --changelog-to <rev>          With --prepare-release: changelog end (default: HEAD)
  --upload                      Upload only (iOS/Android), no build
  --no-update                   Skip git pull, submodule update, flutter pub get (iOS/Android)
  --upload-changelog <path>     Relative path; overrides config upload.changelog_path
  --build-only                  With --platform macos: archive/export only, no altool upload
  --repo-update                 With --platform macos: pod install --repo-update
  --yes                         With --bump-version: bump build number without prompting
  --no-bump-build               With --bump-version: never bump build (non-TTY default for patch/minor/major)
  --project-root <dir>          Flutter app root
  --topic-id <id>               Telegram forum thread (overrides config / TELEGRAM_TOPIC_ID)
  --test-telegram               Send a test Telegram message (needs config + telegram.*)
  --test-upload-file <path>     Send a file via Telegram (path relative to project root)
  --test-changelog-summary <path>  Summarize a changelog with Claude and send it to Telegram
  -h, -help, --help             Show this help

Changelog (must be the first argument; needs git on PATH):
  tunai-build-script --generate-changelog [changelog-options]

  Writes changelog.md (engineering git log) and changelog_tester.md (PR title + description only,
  grouped by main app and submodules; commits need (#N) in subject; gh pr view when logged in). Options:
  --from <rev>           Start revision (tag, branch, SHA, or HEAD)
  --to <rev>             End revision
  --output, -o <path>    Engineering changelog (default: changelog.md)
  --tester-output <path> Tester changelog (default: changelog_tester.md)
  --no-tester            Skip changelog_tester.md
  --fetch-github-pr      Optional (redundant); gh PR fetch is default when gh is logged in
  --no-fetch-github-pr   Skip all GitHub PR fetch
  --github-repo org/repo Main app GitHub owner/repo if origin is not github.com
  --project-root <dir>   Flutter root (default: discover pubspec.yaml)
  --git-root <dir>       Git repo only, no pubspec required
  --strict               Exit with error if main repo git log fails
  [fromRev] [toRev]      Positional range (same as --from / --to)

  PR fetch: GitHub CLI (gh pr view). If gh is not logged in, commit subject/body is used as fallback.
  Submodules use each submodule origin URL; --github-repo applies to the main app only.

  Interactive TTY: prompts for missing from/to. Non-interactive: from defaults to latest tag or HEAD; to defaults to HEAD.

Examples:
  tunai-build-script
  tunai-build-script --platform ios --no-update
  tunai-build-script --release-candidate ios --dry-run
  tunai-build-script --upload --platform android
  tunai-build-script --upload-changelog CHANGELOG.md
  tunai-build-script --test-changelog-summary changelog_tester.md --platform ios
  tunai-build-script --platform macos --build-only
  tunai-build-script --bump-version patch
  tunai-build-script --bump-version manual 1.2.3+5 --project-root /path/to/app
  tunai-build-script --prepare-release patch
  tunai-build-script --prepare-release patch --tag-prefix release --changelog-from v1.0.0
  tunai-build-script --prepare-release build --tag-prefix "" --changelog-from v1.0.0+10
  tunai-build-script --config ~/secrets/staging.json --project-root /path/to/app
  tunai-build-script --generate-changelog
  tunai-build-script --generate-changelog v1.0.0 HEAD
  tunai-build-script --generate-changelog --from v1.0.0 -o release-notes.md
  tunai-build-script --generate-changelog --no-fetch-github-pr v1.0.0 HEAD
`);
}

/**
 * @param {string[]} changelogArgv arguments after --generate-changelog
 * @returns {Promise<number>} exit code
 */
function runGenerateChangelogCli(changelogArgv) {
  const scriptPath = fileURLToPath(
    new URL('../lib/generate-changelog.mjs', import.meta.url),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...changelogArgv], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve(signal ? 1 : code ?? 1);
    });
  });
}

function parseArgs(argv) {
  const out = {
    help: false,
    projectRoot: null,
    config: null,
    bumpType: null,
    manualVersion: null,
    prepareReleaseType: null,
    prepareReleaseManualVersion: null,
    tagPrefix: null,
    changelogFrom: null,
    changelogTo: null,
    bumpYes: false,
    bumpNoBumpBuild: false,
    platform: null,
    macosBuildOnly: false,
    macosRepoUpdate: false,
    uploadOnly: false,
    noUpdate: false,
    uploadChangelog: null,
    topicId: null,
    testTelegram: false,
    testUploadFile: null,
    testChangelogSummary: null,
    testReleasePlatform: null,
    releaseCandidatePlatform: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '-help' || a === '--help') out.help = true;
    else if (a === '--project-root') out.projectRoot = argv[++i];
    else if (a === '--config') {
      out.config = argv[++i];
      if (!out.config || out.config.startsWith('-')) {
        console.error('Error: --config requires a file path');
        process.exit(1);
      }
    } else if (a === '--platform') {
      const p = argv[++i]?.toLowerCase();
      if (!p) {
        console.error('Error: --platform requires ios, android, or macos');
        process.exit(1);
      }
      out.platform = p;
    } else if (a === '--bump-version') {
      const t = argv[++i];
      if (!t || t.startsWith('-')) {
        console.error(
          'Error: --bump-version requires major|minor|patch|build|manual',
        );
        process.exit(1);
      }
      out.bumpType = t.toLowerCase();
      if (!BUMP_TYPES.has(out.bumpType)) {
        console.error(`Error: invalid bump type "${out.bumpType}"`);
        process.exit(1);
      }
      if (out.bumpType === 'manual') {
        out.manualVersion = argv[++i];
        if (!out.manualVersion || out.manualVersion.startsWith('-')) {
          console.error(
            'Error: --bump-version manual requires a version like 1.2.3+5',
          );
          process.exit(1);
        }
      }
    } else if (a === '--prepare-release') {
      const t = argv[++i];
      if (!t || t.startsWith('-')) {
        console.error(
          'Error: --prepare-release requires major|minor|patch|build|manual',
        );
        process.exit(1);
      }
      out.prepareReleaseType = t.toLowerCase();
      if (!BUMP_TYPES.has(out.prepareReleaseType)) {
        console.error(`Error: invalid release type "${out.prepareReleaseType}"`);
        process.exit(1);
      }
      if (out.prepareReleaseType === 'manual') {
        out.prepareReleaseManualVersion = argv[++i];
        if (
          !out.prepareReleaseManualVersion ||
          out.prepareReleaseManualVersion.startsWith('-')
        ) {
          console.error(
            'Error: --prepare-release manual requires a version like 1.2.3+5',
          );
          process.exit(1);
        }
      }
    } else if (a === '--test-release') {
      const pl = argv[++i]?.toLowerCase();
      if (pl !== 'ios' && pl !== 'android') {
        console.error('Error: --test-release requires ios or android');
        process.exit(1);
      }
      out.testReleasePlatform = pl;
    } else if (a === '--release-candidate') {
      const pl = argv[++i]?.toLowerCase();
      if (pl !== 'ios') {
        console.error('Error: --release-candidate currently requires ios');
        process.exit(1);
      }
      out.releaseCandidatePlatform = pl;
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--tag-prefix') {
      const v = argv[++i];
      if (v === undefined) {
        console.error('Error: --tag-prefix requires a value (use "" for none)');
        process.exit(1);
      }
      out.tagPrefix = v;
    } else if (a === '--changelog-from') {
      out.changelogFrom = argv[++i];
      if (!out.changelogFrom || out.changelogFrom.startsWith('-')) {
        console.error('Error: --changelog-from requires a revision');
        process.exit(1);
      }
    } else if (a === '--changelog-to') {
      out.changelogTo = argv[++i];
      if (!out.changelogTo || out.changelogTo.startsWith('-')) {
        console.error('Error: --changelog-to requires a revision');
        process.exit(1);
      }
    } else if (a === '--upload') out.uploadOnly = true;
    else if (a === '--no-update') out.noUpdate = true;
    else if (a === '--upload-changelog') out.uploadChangelog = argv[++i];
    else if (a === '--topic-id') out.topicId = argv[++i];
    else if (a === '--test-telegram') out.testTelegram = true;
    else if (a === '--test-upload-file') out.testUploadFile = argv[++i];
    else if (a === '--test-changelog-summary') {
      out.testChangelogSummary = argv[++i];
      if (
        !out.testChangelogSummary ||
        out.testChangelogSummary.startsWith('-')
      ) {
        console.error('Error: --test-changelog-summary requires a file path');
        process.exit(1);
      }
    }
    else if (a === '--build-only') out.macosBuildOnly = true;
    else if (a === '--repo-update') out.macosRepoUpdate = true;
    else if (a === '--yes') out.bumpYes = true;
    else if (a === '--no-bump-build') out.bumpNoBumpBuild = true;
    else {
      console.error(`Unknown argument: ${a}`);
      usage();
      process.exit(1);
    }
  }

  return out;
}

function findPubspecRoot(startDir) {
  let dir = path.resolve(startDir);
  const { root: fsRoot } = path.parse(dir);
  while (true) {
    if (fs.existsSync(path.join(dir, 'pubspec.yaml'))) return dir;
    if (dir === fsRoot) break;
    dir = path.dirname(dir);
  }
  return null;
}

function resolvePubspecRoot(explicit) {
  if (explicit) {
    const root = path.resolve(explicit);
    if (!fs.existsSync(path.join(root, 'pubspec.yaml'))) {
      console.error(`Error: pubspec.yaml not found in ${root}`);
      process.exit(1);
    }
    return root;
  }
  const found = findProjectWithConfig(process.cwd());
  if (found) return found.projectRoot;
  const pubRoot = findPubspecRoot(process.cwd());
  if (pubRoot) return pubRoot;
  console.error(
    'Error: Could not find pubspec.yaml. Pass --project-root or run from your Flutter app.',
  );
  process.exit(1);
}

function resolveConfigFilePath(configArg) {
  const configPath = path.resolve(configArg);
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exit(1);
  }
  if (!fs.statSync(configPath).isFile()) {
    console.error(`Error: Config path is not a file: ${configPath}`);
    process.exit(1);
  }
  return configPath;
}

function resolveProjectRootWithConfig(explicitProjectRoot, explicitConfigPath) {
  if (explicitConfigPath) {
    const configPath = resolveConfigFilePath(explicitConfigPath);
    if (explicitProjectRoot) {
      const root = path.resolve(explicitProjectRoot);
      if (!fs.existsSync(path.join(root, 'pubspec.yaml'))) {
        console.warn('Warning: pubspec.yaml not found in project root');
      }
      return { projectRoot: root, configPath };
    }
    const configDir = path.dirname(configPath);
    const pubInConfigDir = findPubspecRoot(configDir);
    if (pubInConfigDir) {
      return { projectRoot: pubInConfigDir, configPath };
    }
    const pubFromCwd = findPubspecRoot(process.cwd());
    if (pubFromCwd) {
      return { projectRoot: pubFromCwd, configPath };
    }
    console.error(
      'Error: Could not determine Flutter project root. Pass --project-root with --config.',
    );
    process.exit(1);
  }

  if (explicitProjectRoot) {
    const root = path.resolve(explicitProjectRoot);
    const cfg = path.join(root, CONFIG_FILENAME);
    if (!fs.existsSync(cfg)) {
      console.error(`Error: ${CONFIG_FILENAME} not found in ${root}`);
      process.exit(1);
    }
    if (!fs.existsSync(path.join(root, 'pubspec.yaml'))) {
      console.warn('Warning: pubspec.yaml not found in project root');
    }
    return { projectRoot: root, configPath: cfg };
  }
  const found = findProjectWithConfig(process.cwd());
  if (!found) {
    console.error(
      `Error: Could not find ${CONFIG_FILENAME} in this directory or any parent.`,
    );
    console.error(
      `Add ${CONFIG_FILENAME} to your Flutter app root, or pass --config or --project-root.`,
    );
    process.exit(1);
  }
  return found;
}

function resolvePrepareReleaseContext(explicitProjectRoot, explicitConfigPath) {
  if (explicitConfigPath) {
    const configPath = resolveConfigFilePath(explicitConfigPath);
    if (explicitProjectRoot) {
      return {
        projectRoot: resolvePubspecRoot(explicitProjectRoot),
        configPath,
      };
    }

    const pubInConfigDir = findPubspecRoot(path.dirname(configPath));
    return {
      projectRoot: pubInConfigDir || resolvePubspecRoot(null),
      configPath,
    };
  }

  const projectRoot = resolvePubspecRoot(explicitProjectRoot);
  const configPath = path.join(projectRoot, CONFIG_FILENAME);
  return {
    projectRoot,
    configPath:
      fs.existsSync(configPath) && fs.statSync(configPath).isFile()
        ? configPath
        : null,
  };
}

function resolveMacosAppDir(explicitProjectRoot) {
  if (explicitProjectRoot) {
    const r = path.resolve(explicitProjectRoot);
    if (!fs.existsSync(path.join(r, 'macos'))) {
      console.error(`Error: macos/ not found under ${r}`);
      process.exit(1);
    }
    return r;
  }
  const found = findProjectWithConfig(process.cwd());
  if (found) return found.projectRoot;
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'macos'))) return cwd;
  console.error(
    'Error: Could not find macos/. Pass --project-root to your Flutter app or add tunai_build_script_config.json at the app root.',
  );
  process.exit(1);
}

function validateNoMix(args, mode) {
  if (mode === 'release-candidate') {
    const conflicts = [
      ['testReleasePlatform', 'Error: choose --release-candidate or --test-release'],
      ['prepareReleaseType', 'Error: do not combine --release-candidate with --prepare-release'],
      ['bumpType', 'Error: do not combine --release-candidate with --bump-version'],
      ['platform', 'Error: do not use --platform with --release-candidate'],
      ['uploadOnly', 'Error: do not use --upload with --release-candidate'],
      ['noUpdate', 'Error: --release-candidate already builds without git pull/pub get'],
      ['testTelegram', 'Error: do not combine --release-candidate with Telegram test flags'],
      ['testUploadFile', 'Error: do not combine --release-candidate with Telegram test flags'],
      ['testChangelogSummary', 'Error: do not combine --release-candidate with Telegram test flags'],
      ['macosBuildOnly', 'Error: --build-only / --repo-update are only for --platform macos'],
      ['macosRepoUpdate', 'Error: --build-only / --repo-update are only for --platform macos'],
    ];
    for (const [key, msg] of conflicts) {
      if (args[key]) {
        console.error(msg);
        process.exit(1);
      }
    }
  }
  if (mode === 'prepare-release') {
    const conflicts = [
      ['platform', 'Error: do not use --platform with --prepare-release'],
      ['uploadOnly', 'Error: do not use --upload with --prepare-release'],
      [
        'testTelegram',
        'Error: do not combine --prepare-release with --test-telegram / --test-upload-file',
      ],
      [
        'testUploadFile',
        'Error: do not combine --prepare-release with --test-telegram / --test-upload-file',
      ],
      [
        'testChangelogSummary',
        'Error: do not combine --prepare-release with Telegram test flags',
      ],
      [
        'macosBuildOnly',
        'Error: --build-only / --repo-update are only for --platform macos',
      ],
      [
        'macosRepoUpdate',
        'Error: --build-only / --repo-update are only for --platform macos',
      ],
      ['bumpType', 'Error: use --prepare-release or --bump-version, not both'],
    ];
    for (const [key, msg] of conflicts) {
      if (args[key]) {
        console.error(msg);
        process.exit(1);
      }
    }
  }
  if (mode === 'bump') {
    if (args.prepareReleaseType) {
      console.error('Error: use --prepare-release or --bump-version, not both');
      process.exit(1);
    }
    if (args.platform) {
      console.error('Error: do not use --platform with --bump-version');
      process.exit(1);
    }
    if (args.uploadOnly) {
      console.error('Error: do not use --upload with --bump-version');
      process.exit(1);
    }
    if (
      args.testTelegram ||
      args.testUploadFile ||
      args.testChangelogSummary
    ) {
      console.error(
        'Error: do not combine --bump-version with --test-telegram / --test-upload-file',
      );
      process.exit(1);
    }
    if (args.macosBuildOnly || args.macosRepoUpdate) {
      console.error(
        'Error: --build-only / --repo-update are only for --platform macos',
      );
      process.exit(1);
    }
  }
  if (mode === 'build') {
    if (args.macosBuildOnly || args.macosRepoUpdate) {
      console.error(
        'Error: --build-only and --repo-update require --platform macos',
      );
      process.exit(1);
    }
  }

  if (mode === 'macos') {
    if (args.uploadOnly) {
      console.error(
        'Error: --upload (iOS/Android distribution) applies only to iOS/Android, not macOS TestFlight',
      );
      process.exit(1);
    }
    if (args.bumpType || args.prepareReleaseType) {
      console.error(
        'Error: do not combine --platform macos with --bump-version or --prepare-release',
      );
      process.exit(1);
    }
    if (
      args.testTelegram ||
      args.testUploadFile ||
      args.testChangelogSummary
    ) {
      console.error(
        'Error: do not combine --platform macos with Telegram test flags',
      );
      process.exit(1);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--generate-changelog') {
    const code = await runGenerateChangelogCli(argv.slice(1));
    process.exit(code);
    return;
  }

  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return;
  }

  const mode = args.releaseCandidatePlatform
    ? 'release-candidate'
    : args.testReleasePlatform
      ? 'test-release'
    : args.prepareReleaseType
    ? 'prepare-release'
    : args.bumpType
      ? 'bump'
      : args.platform === 'macos'
        ? 'macos'
        : 'build';

  validateNoMix(args, mode);

  if (mode === 'release-candidate') {
    const { projectRoot, configPath } = resolveProjectRootWithConfig(
      args.projectRoot,
      args.config,
    );
    console.log(
      `Release candidate (${args.releaseCandidatePlatform}) in: ${projectRoot}`,
    );
    console.log(`Using config: ${configPath}`);

    const sourceConfig = loadConfigFile(configPath);
    const releaseConfig = getPrepareReleaseSection(sourceConfig);
    const candidate = prepareReleaseCandidate({
      projectRoot,
      config: sourceConfig,
      platform: args.releaseCandidatePlatform,
      writeFiles: !args.dryRun,
    });
    const changelogPaths = Array.isArray(releaseConfig.changelog_paths)
      ? releaseConfig.changelog_paths
      : null;
    const tagPrefix = args.tagPrefix ?? candidate.tagPrefix;
    let cumulativeChangelog = null;
    if (candidate.cumulativeChangelog) {
      const fromRev = await getLastTagMatchingPrefix(
        projectRoot,
        candidate.cumulativeChangelog.fromTagPrefix,
      );
      if (!fromRev) {
        throw new Error(
          `No reachable production tag matches ${candidate.cumulativeChangelog.fromTagPrefix}-v*`,
        );
      }
      cumulativeChangelog = {
        ...candidate.cumulativeChangelog,
        fromRev,
        previousVersion: versionFromPrefixedTag(
          fromRev,
          candidate.cumulativeChangelog.fromTagPrefix,
        ),
      };
    }

    console.log('Channel: production');
    console.log(`iOS bundle id: ${candidate.iosBundleId}`);
    console.log(`iOS export options: ${candidate.exportOptionsPath}`);
    console.log(`iOS archive signing: manual, ${candidate.archiveSigning.certificate}, ${candidate.archiveSigning.profile}`);
    console.log('Distribution: Buildport');
    console.log(
      `Buildport app group: ${candidate.buildportAppGroup ?? '(pubspec name)'}`,
    );
    if (cumulativeChangelog) {
      console.log(
        `Cumulative changelog: ${cumulativeChangelog.fromRev} .. HEAD -> ${cumulativeChangelog.outputPath}`,
      );
      console.log(
        `Cumulative Telegram destination: chat ${cumulativeChangelog.telegram.chat_id}, topic ${cumulativeChangelog.telegram.topic_id}`,
      );
    }

    if (args.dryRun) {
      console.log('\nDry run — would now:');
      console.log('  1. Write production .env and iOS channel.xcconfig');
      console.log(
        `  2. prepare-release (build bump), tag prefix "${tagPrefix}"` +
          (changelogPaths
            ? `, changelog scoped to: ${changelogPaths.join(' ')}`
            : ''),
      );
      if (cumulativeChangelog) {
        console.log(
          `     Also generate cumulative tester changelog from ${cumulativeChangelog.fromRev}`,
        );
      }
      console.log(
        '  3. build IPA with production ad-hoc signing, validate its bundle/config, and upload to Buildport',
      );
      if (cumulativeChangelog) {
        console.log(
          '  4. send the cumulative AI summary and changelog to its configured Telegram topic',
        );
      }
      return;
    }

    const release = await runPrepareRelease({
      projectRoot,
      bumpType: 'build',
      changelogFrom: args.changelogFrom,
      changelogTo: args.changelogTo,
      tagPrefix,
      changelogPaths,
      supplementalTesterChangelog: cumulativeChangelog
        ? {
            fromRev: cumulativeChangelog.fromRev,
            outputPath: cumulativeChangelog.outputPath,
          }
        : null,
    });

    const changelogEffective =
      args.uploadChangelog ||
      (candidate.config.upload &&
        candidate.config.upload.changelog_path) ||
      null;
    await performBuild({
      projectRoot,
      config: candidate.config,
      iosArchiveSigning: candidate.archiveSigning,
      platform: args.releaseCandidatePlatform,
      update: false,
      changelogRelativePath: changelogEffective,
      topicIdOverride:
        args.topicId || process.env.TELEGRAM_TOPIC_ID || undefined,
      previousVersion: release.previousVersion,
      additionalChangelogDeliveries: cumulativeChangelog
        ? [
            {
              changelogRelativePath: cumulativeChangelog.outputPath,
              telegram: cumulativeChangelog.telegram,
              previousVersion: cumulativeChangelog.previousVersion,
              label: 'cumulative changelog',
              summaryTitle: 'Full Release Summary',
              documentTitle: 'Full changelog since production',
            },
          ]
        : [],
      validateBuildArtifact: (ipaPath) =>
        validateIosReleaseCandidateArtifact({
          ipaPath,
          expectedBundleId: candidate.iosBundleId,
          expectedDisplayName: candidate.iosDisplayName,
        }),
    });
    return;
  }

  if (mode === 'test-release') {
    const { projectRoot, configPath } = resolveProjectRootWithConfig(
      args.projectRoot,
      args.config,
    );
    console.log(`Test release (${args.testReleasePlatform}) in: ${projectRoot}`);
    console.log(`Using config: ${configPath}`);
    const config = loadConfigFile(configPath);
    const releaseConfig = getPrepareReleaseSection(config);
    const channel = (config.channel && config.channel.test) || {};
    const channelEnvironment = prepareChannelEnvironment({
      projectRoot,
      channel,
      channelName: 'test',
      expectedTestVersion: true,
      writeFile: !args.dryRun,
    });
    const changelogPaths = Array.isArray(releaseConfig.changelog_paths)
      ? releaseConfig.changelog_paths
      : null;
    const tagPrefix =
      args.tagPrefix ??
      (Object.prototype.hasOwnProperty.call(releaseConfig, 'tag_prefix')
        ? releaseConfig.tag_prefix
        : null);

    if (args.testReleasePlatform === 'ios' && channel.ios_bundle_id) {
      const channelFile = path.join(
        projectRoot,
        'ios',
        'Flutter',
        'channel.xcconfig',
      );
      const content =
        `// Written by tunai-build-script (--test-release). Do not commit.\n` +
        `PRODUCT_BUNDLE_IDENTIFIER = ${channel.ios_bundle_id}\n` +
        (channel.ios_display_name
          ? `APP_DISPLAY_NAME = ${channel.ios_display_name}\n`
          : '');
      if (!args.dryRun) {
        fs.mkdirSync(path.dirname(channelFile), { recursive: true });
        fs.writeFileSync(channelFile, content, 'utf8');
      }
      console.log(
        `Channel: test (iOS bundle id ${channel.ios_bundle_id})`,
      );
    }
    console.log(
      `Channel environment: TestVersion=${channelEnvironment.testVersion}`,
    );

    if (args.dryRun) {
      console.log('\nDry run — would now:');
      console.log(
        `  1. Write test .env${
          args.testReleasePlatform === 'ios' ? ' and iOS channel.xcconfig' : ''
        }`,
      );
      console.log(
        `  2. prepare-release (build bump), tag prefix "${tagPrefix ?? ''}"` +
          (changelogPaths
            ? `, changelog scoped to: ${changelogPaths.join(' ')}`
            : ''),
      );
      console.log(
        `  3. build + upload ${args.testReleasePlatform} (no git pull/pub get)`,
      );
      return;
    }

    const release = await runPrepareRelease({
      projectRoot,
      bumpType: 'build',
      changelogFrom: args.changelogFrom,
      changelogTo: args.changelogTo,
      tagPrefix: tagPrefix ?? '',
      changelogPaths,
    });

    const changelogEffective =
      args.uploadChangelog ||
      (config.upload && config.upload.changelog_path) ||
      null;
    await performBuild({
      projectRoot,
      config,
      platform: args.testReleasePlatform,
      update: false,
      changelogRelativePath: changelogEffective,
      topicIdOverride:
        args.topicId || process.env.TELEGRAM_TOPIC_ID || undefined,
      previousVersion: release.previousVersion,
    });
    return;
  }

  if (mode === 'prepare-release') {
    const { projectRoot: root, configPath } = resolvePrepareReleaseContext(
      args.projectRoot,
      args.config,
    );
    let configTagPrefix = null;
    if (configPath) {
      console.log(`Using config: ${configPath}`);
      const config = loadConfigFile(configPath);
      const releaseConfig = getPrepareReleaseSection(config);
      if (Object.prototype.hasOwnProperty.call(releaseConfig, 'tag_prefix')) {
        configTagPrefix = releaseConfig.tag_prefix;
      }
    }
    console.log(
      `Prepare release (${args.prepareReleaseType}) in: ${path.resolve(root)}`,
    );
    await runPrepareRelease({
      projectRoot: root,
      bumpType: args.prepareReleaseType,
      manualVersion: args.prepareReleaseManualVersion,
      changelogFrom: args.changelogFrom,
      changelogTo: args.changelogTo,
      tagPrefix: args.tagPrefix ?? configTagPrefix ?? '',
    });
    return;
  }

  if (mode === 'bump') {
    const root = resolvePubspecRoot(args.projectRoot);
    console.log(`Bumping ${args.bumpType} in: ${path.resolve(root)}`);
    await bumpVersion({
      projectRoot: root,
      bumpType: args.bumpType,
      manualVersion: args.manualVersion,
      yes: args.bumpYes,
      noBumpBuild: args.bumpNoBumpBuild,
    });
    return;
  }

  if (mode === 'macos') {
    const appDir = resolveMacosAppDir(args.projectRoot);
    const configPath = args.config
      ? resolveConfigFilePath(args.config)
      : null;
    console.log(`Using app directory: ${appDir}`);
    if (configPath) {
      console.log(`Using config: ${configPath}`);
    }
    const code = await runMacosTestflightScript({
      appDir,
      configPath,
      buildOnly: args.macosBuildOnly,
      repoUpdate: args.macosRepoUpdate,
    });
    process.exit(code);
  }

  const { projectRoot, configPath } = resolveProjectRootWithConfig(
    args.projectRoot,
    args.config,
  );
  console.log(`Using project root: ${projectRoot}`);
  console.log(`Using config: ${configPath}`);

  const config = loadConfigFile(configPath);

  const topicOverride =
    args.topicId || process.env.TELEGRAM_TOPIC_ID || undefined;

  if (args.testTelegram) {
    const telegram = getTelegramSection(config);
    if (!telegram) {
      console.error(
        'Error: Configure telegram.bot_token and telegram.chat_id in tunai_build_script_config.json',
      );
      process.exit(1);
    }
    const testMessage =
      `🧪 <b>Telegram Bot Test</b>\n\n` +
      `This is a test message from tunai-build-script.\n\n` +
      `Timestamp: ${new Date().toISOString()}\n` +
      `Project: ${projectRoot}\n`;
    await sendTelegramMessage({
      botToken: telegram.bot_token,
      chatId: telegram.chat_id,
      topicId: topicOverride || telegram.topic_id,
      text: testMessage,
    });
    console.log('Test completed. Check your Telegram chat.');
    return;
  }

  if (args.testUploadFile) {
    const telegram = getTelegramSection(config);
    if (!telegram) {
      console.error(
        'Error: Configure telegram in tunai_build_script_config.json',
      );
      process.exit(1);
    }
    const filePath = path.join(projectRoot, args.testUploadFile);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    await sendTelegramDocument({
      botToken: telegram.bot_token,
      chatId: telegram.chat_id,
      filePath,
      topicId: topicOverride || telegram.topic_id,
      caption: '🧪 Test file upload from tunai-build-script',
    });
    console.log('Test completed. Check your Telegram chat.');
    return;
  }

  if (args.testChangelogSummary) {
    const telegram = getTelegramSection(config);
    const summaryConfig = getTelegramChangelogSummarySection(config);
    if (!telegram) {
      console.error(
        'Error: Configure telegram.bot_token and telegram.chat_id in tunai_build_script_config.json',
      );
      process.exit(1);
    }
    if (!summaryConfig) {
      console.error(
        'Error: Set telegram.changelog_summary.enabled to true in tunai_build_script_config.json',
      );
      process.exit(1);
    }

    const changelogFile = path.isAbsolute(args.testChangelogSummary)
      ? args.testChangelogSummary
      : path.join(projectRoot, args.testChangelogSummary);
    if (!fs.existsSync(changelogFile)) {
      console.error(`Error: File not found: ${changelogFile}`);
      process.exit(1);
    }

    const platform = args.platform || detectPlatform(projectRoot);
    if (platform !== 'ios' && platform !== 'android') {
      console.error(
        'Error: Specify --platform ios or --platform android for the changelog summary',
      );
      process.exit(1);
    }
    const appInfo = getAppInfo(projectRoot, platform);
    const appName = appInfo.app_group || appInfo.name || 'App';
    const version = getVersion(projectRoot) || 'unknown';
    console.log(
      `Generating Telegram changelog summary with Claude (${summaryConfig.model})...`,
    );
    const generated = await generateChangelogSummary({
      changelogFile,
      appName,
      platform,
      version,
      summaryConfig,
    });
    const messages = Array.isArray(generated) ? generated : [generated];
    let allSent = true;
    for (const text of messages) {
      const sent = await sendTelegramMessage({
        botToken: telegram.bot_token,
        chatId: telegram.chat_id,
        topicId: topicOverride || telegram.topic_id,
        text,
      });
      if (!sent) allSent = false;
    }
    if (!allSent) {
      throw new Error('Telegram rejected the AI changelog summary');
    }
    console.log('AI changelog summary test completed. Check Telegram.');
    return;
  }

  let platform = args.platform;
  if (platform && platform !== 'ios' && platform !== 'android') {
    console.error('Error: for iOS/Android use --platform ios or android');
    process.exit(1);
  }
  if (!platform) {
    platform = detectPlatform(projectRoot);
  }
  if (!platform) {
    console.error(
      'Error: Could not determine platform. Specify --platform ios or --platform android',
    );
    process.exit(1);
  }
  console.log(`Using platform: ${platform}`);

  const changelogEffective =
    args.uploadChangelog ||
    (config.upload && config.upload.changelog_path) ||
    null;

  if (args.uploadOnly) {
    await performUpload({
      projectRoot,
      config,
      platform,
      changelogRelativePath: changelogEffective,
      topicIdOverride: topicOverride,
    });
    return;
  }

  await performBuild({
    projectRoot,
    config,
    platform,
    update: !args.noUpdate,
    changelogRelativePath: changelogEffective,
    topicIdOverride: topicOverride,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
