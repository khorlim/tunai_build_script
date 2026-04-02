#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { findProjectWithConfig, CONFIG_FILENAME } from '../lib/find-project.mjs';
import { loadConfigFile, getTelegramSection } from '../lib/config.mjs';
import { detectPlatform } from '../lib/platform-detect.mjs';
import { performBuild, performUpload } from '../lib/build.mjs';
import { sendTelegramMessage, sendTelegramDocument } from '../lib/telegram.mjs';

function usage() {
  console.log(`Usage: tunai-build-script [options]

Runs from your Flutter app repo (or any parent directory containing ${CONFIG_FILENAME}).

Options:
  --project-root <dir>     Flutter project root (must contain ${CONFIG_FILENAME})
  --platform ios|android   Override auto-detect
  --upload                 Upload only (skip build)
  --no-update              Skip git pull, submodule update, flutter pub get
  --upload-changelog <path> Path relative to project root (overrides config.upload.changelog_path)
  --topic-id <id>          Telegram forum thread (overrides config / TELEGRAM_TOPIC_ID)
  --test-telegram          Send a test Telegram message
  --test-upload-file <path> Send a test file via Telegram (path relative to project root)
  -h, --help               Show this help
`);
}

function parseArgs(argv) {
  const out = {
    projectRoot: null,
    platform: null,
    uploadOnly: false,
    noUpdate: false,
    uploadChangelog: null,
    topicId: null,
    testTelegram: false,
    testUploadFile: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--project-root') out.projectRoot = argv[++i];
    else if (a === '--platform') out.platform = argv[++i]?.toLowerCase();
    else if (a === '--upload') out.uploadOnly = true;
    else if (a === '--no-update') out.noUpdate = true;
    else if (a === '--upload-changelog') out.uploadChangelog = argv[++i];
    else if (a === '--topic-id') out.topicId = argv[++i];
    else if (a === '--test-telegram') out.testTelegram = true;
    else if (a === '--test-upload-file') out.testUploadFile = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      usage();
      process.exit(1);
    }
  }
  return out;
}

function resolveProjectRoot(explicit) {
  if (explicit) {
    const root = path.resolve(explicit);
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
      'Add tunai_build_script_config.json to your Flutter app root, or pass --project-root.',
    );
    process.exit(1);
  }
  return found;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const { projectRoot, configPath } = resolveProjectRoot(args.projectRoot);
  console.log(`Using project root: ${projectRoot}`);

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

  let platform = args.platform;
  if (platform && platform !== 'ios' && platform !== 'android') {
    console.error('Error: --platform must be ios or android');
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
