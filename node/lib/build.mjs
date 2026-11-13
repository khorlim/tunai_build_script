import fs from 'fs';
import path from 'path';
import { getAppInfo } from './app-info.mjs';
import { runInherit } from './run.mjs';
import { withIosArchiveSigning } from './ios-archive-signing.mjs';
import { getVersion } from './pubspec.mjs';
import {
  getBuildportSection,
  getLoadlySection,
  getTelegramSection,
} from './config.mjs';
import { findAndroidBuildFile, findIpaFile } from './artifacts.mjs';
import { uploadToBuildport } from './buildport-upload.mjs';
import { uploadToLoadly } from './loadly-upload.mjs';
import { sendTelegramDocument, sendTelegramMessage } from './telegram.mjs';
import { formatBuildportUploadMessage } from './buildport-telegram.mjs';

function resolvePath(projectRoot, rel) {
  if (!rel) return null;
  return path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
}

const SAFE_ERROR_NAMES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AbortError',
  'AggregateError', 'TimeoutError', 'ConnectTimeoutError',
]);
const SAFE_ERROR_CODES = new Set([
  'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'ABORT_ERR',
]);

// Read only data properties; getters (including inherited ones) may run arbitrary code.
function ownData(object, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined; // A Proxy can also trap descriptor inspection.
  }
}

function safeErrorName(error) {
  let current = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const name = ownData(current, 'name');
    if (SAFE_ERROR_NAMES.has(name)) return name;
    // An own accessor must not be bypassed by an inherited name.
    try {
      if (Object.getOwnPropertyDescriptor(current, 'name')) break;
      current = Object.getPrototypeOf(current);
    } catch {
      break;
    }
  }
  return undefined;
}

// Never stringify an exception: messages, stacks and arbitrary codes can contain
// the bot URL, token, or message payload. Bound both nodes and array fanout.
export function safeErrorDetails(error) {
  const details = [];
  const seen = new Set();
  const pending = [error];
  while (pending.length && details.length < 8) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const entry = {};
    const name = safeErrorName(current);
    const code = ownData(current, 'code');
    if (name) entry.name = name;
    if (SAFE_ERROR_CODES.has(code)) entry.code = code;
    details.push(entry);
    pending.push(ownData(current, 'cause'));
    const errors = ownData(current, 'errors');
    if (name === 'AggregateError') {
      // IsArray itself throws for revoked Proxies, even before descriptor reads.
      let isArray = false;
      try {
        isArray = Array.isArray(errors);
      } catch {
        // Ignore hostile metadata without masking the original exception.
      }
      if (isArray) {
        const length = ownData(errors, 'length');
        for (let i = 0; i < Math.min(Number.isSafeInteger(length) && length >= 0 ? length : 0, 8); i++) {
          pending.push(ownData(errors, String(i)));
        }
      }
    }
  }
  return JSON.stringify(details);
}

/**
 * Release notes for BuildPort, in priority order: --notes-file, --notes,
 * then buildport.notes_path from the config. --notes-file is relative to the
 * current directory like any CLI path; notes_path is relative to the project
 * root. A missing --notes-file is an error; a missing configured notes_path
 * only warns, so routine builds are not blocked.
 */
export function resolveBuildportNotes({ projectRoot, notes, buildport }) {
  if (notes?.file) {
    const file = path.resolve(notes.file);
    if (!fs.existsSync(file)) throw new Error(`Notes file not found: ${file}`);
    return fs.readFileSync(file, 'utf8').trim();
  }
  if (typeof notes?.text === 'string' && notes.text.trim()) return notes.text.trim();
  if (buildport?.notes_path) {
    const file = resolvePath(projectRoot, buildport.notes_path);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    console.warn(`Warning: buildport.notes_path not found: ${file}; uploading without notes`);
  }
  return '';
}

export async function deliverTelegramChangelog({
  projectRoot,
  changelogRelativePath,
  telegram,
  appName,
  platform,
  version,
  label = 'changelog',
  documentTitle = 'Changelog',
  receiptPath,
  receiptPrefix = 'incremental',
  sendDocumentImpl = sendTelegramDocument,
}) {
  const changelogFile = resolvePath(projectRoot, changelogRelativePath);
  if (!changelogFile || !fs.existsSync(changelogFile)) {
    console.warn(
      `Warning: ${documentTitle} file not found: ${changelogFile || changelogRelativePath}`,
    );
    return false;
  }

  console.log(`Uploading ${label} file: ${changelogFile}`);
  let document;
  try {
    document = await sendDocumentImpl({
      botToken: telegram.bot_token,
      chatId: telegram.chat_id,
      filePath: changelogFile,
      topicId: telegram.topic_id,
      caption:
        `📝 ${documentTitle}\n\n` +
        `App: ${appName}\nPlatform: ${platform}\nVersion: ${version}`,
      receiptPath,
      receipt: {
        delivery: `${receiptPrefix}_document`,
        version,
      },
    });
  } catch (error) {
    throw new Error(`Telegram ${label} document send failed (error=${safeErrorDetails(error)})`);
  }
  if (receiptPath && !document) {
    throw new Error(`Telegram rejected the ${label} document`);
  }
  return document;
}

function resolveUploadProvider(config, platform) {
  const providers = config?.upload?.providers;
  const byPlatform =
    providers && typeof providers === 'object'
      ? providers[platform]
      : undefined;
  const raw = byPlatform ?? config?.upload?.provider ?? 'buildport';
  return String(raw).toLowerCase();
}

function findBuildArtifact(projectRoot, platform) {
  if (platform === 'ios') {
    return {
      path: findIpaFile(projectRoot),
      missingMessage:
        'Could not find IPA file in build/ios/ipa after a successful iOS build',
      foundMessage: 'Found IPA file',
    };
  }

  if (platform === 'android') {
    return {
      path: findAndroidBuildFile(projectRoot),
      missingMessage:
        'Could not find AAB/APK under build/app/outputs after a successful Android build',
      foundMessage: 'Found Android build file',
    };
  }

  throw new Error(`Unknown platform: ${platform}`);
}

function resolveUploadBuildFile(projectRoot, platform, explicitBuildFilePath) {
  if (explicitBuildFilePath) {
    if (!fs.existsSync(explicitBuildFilePath)) {
      console.error(`Error: Build file not found: ${explicitBuildFilePath}`);
      process.exit(1);
    }
    return explicitBuildFilePath;
  }

  const artifact = findBuildArtifact(projectRoot, platform);
  if (!artifact.path) {
    console.error(`Error: ${artifact.missingMessage}`);
    process.exit(1);
  }
  console.log(`${artifact.foundMessage}: ${artifact.path}`);
  return artifact.path;
}

export async function performUpload({
  projectRoot,
  config,
  platform,
  changelogRelativePath,
  topicIdOverride,
  buildFilePath,
  notes,
  additionalChangelogDeliveries = [],
  telegramReceiptPath,
}) {
  console.log(`Starting the upload process for ${platform}...`);

  const version = getVersion(projectRoot);
  if (!version) {
    console.error('Error: Could not find version in pubspec.yaml');
    process.exit(1);
  }

  const provider = resolveUploadProvider(config, platform);
  if (
    provider !== 'buildport' &&
    provider !== 'loadly' &&
    provider !== 'telegram_apk'
  ) {
    console.error(
      `Error: upload provider must be "buildport", "loadly", or "telegram_apk", got "${provider}"`,
    );
    process.exit(1);
  }

  const resolvedBuildFilePath = resolveUploadBuildFile(
    projectRoot,
    platform,
    buildFilePath,
  );

  const appInfo = getAppInfo(projectRoot, platform);
  const appName = appInfo.app_group || appInfo.name || 'App';
  const telegram = getTelegramSection(config);
  const topicId =
    topicIdOverride ||
    telegram?.topic_id ||
    process.env.TELEGRAM_TOPIC_ID ||
    undefined;

  if (provider === 'telegram_apk') {
    if (platform !== 'android') {
      console.error(
        'Error: upload provider "telegram_apk" is supported only for Android',
      );
      process.exit(1);
    }
    if (!telegram) {
      console.error(
        'Error: upload provider "telegram_apk" requires telegram.bot_token and telegram.chat_id in tunai_build_script_config.json',
      );
      process.exit(1);
    }

    console.log('Sending Android APK directly to Telegram...');
    const apkSent = await sendTelegramDocument({
      botToken: telegram.bot_token,
      chatId: telegram.chat_id,
      topicId,
      filePath: resolvedBuildFilePath,
      caption:
        `📦 Android APK\n\n` +
        `App: ${appName}\n` +
        `Platform: ${platform}\n` +
        `Version: ${version}`,
      receiptPath: telegramReceiptPath,
      receipt: {
        delivery: 'android_apk',
        version,
        platform,
      },
    });
    if (!apkSent) {
      throw new Error(
        'Telegram APK delivery failed. Check bot membership, chat/topic id, and Telegram API error details above.',
      );
    }
    await sendTelegramMessage({
      botToken: telegram.bot_token,
      chatId: telegram.chat_id,
      topicId,
      text:
        `✅ <b>Build Completed Successfully</b>\n\n` +
        `App: ${appName}\n` +
        `Platform: ${platform}\n` +
        `Version: ${version}\n\n` +
        `APK has been sent as a Telegram document.`,
      receiptPath: telegramReceiptPath,
      receipt: {
        delivery: 'android_build_notification',
        version,
        platform,
      },
    });
    console.log('Telegram APK delivery completed successfully!');
  } else {
    let installUrl;
    let buildportUpload = null;
    if (provider === 'buildport') {
      const buildport = getBuildportSection(config);
      if (!buildport) {
        console.error(
          'Error: upload provider is "buildport" but buildport.api_token or BUILDPORT_API_TOKEN is missing',
        );
        process.exit(1);
      }
      const releaseNotes = resolveBuildportNotes({ projectRoot, notes, buildport });
      console.log(
        releaseNotes
          ? `Sending ${releaseNotes.length} characters of release notes to BuildPort`
          : 'No release notes for this build (add them later with --buildport-notes <token>)',
      );
      buildportUpload = await uploadToBuildport({
        buildFilePath: resolvedBuildFilePath,
        version,
        appInfo,
        buildport,
        notes: releaseNotes,
      });
      installUrl = buildportUpload.url;
      if (buildportUpload.response?.token) {
        console.log(`BuildPort build token: ${buildportUpload.response.token}`);
        console.log(
          `Update its notes later: tunai-build-script --buildport-notes ${buildportUpload.response.token} --notes-file <file>`,
        );
      }
    } else if (provider === 'loadly') {
      const loadly = getLoadlySection(config);
      if (!loadly) {
        console.error(
          'Error: upload provider is "loadly" but loadly.api_key is missing in tunai_build_script_config.json',
        );
        process.exit(1);
      }
      installUrl = await uploadToLoadly({
        buildFilePath: resolvedBuildFilePath,
        loadly,
      });
    }

    console.log('Upload completed successfully!');
    console.log('Install your app from:');
    console.log(installUrl);
    console.log('');

    if (telegram) {
      let notification;
      try {
        notification = await sendTelegramMessage({
          botToken: telegram.bot_token,
          chatId: telegram.chat_id,
          topicId,
          text: buildportUpload
            ? formatBuildportUploadMessage({
                platform,
                version,
                fallbackAppName: appName,
                upload: buildportUpload,
              })
            : `✅ <b>Build & Upload Completed Successfully</b>\n\n` +
            `App: ${appName}\n` +
            `Platform: ${platform}\n` +
            `Version: ${version}\n\n` +
            `📱 <b>Install URL:</b>\n${installUrl}`,
          receiptPath: telegramReceiptPath,
          receipt: {
            delivery: 'build_upload_notification',
            version,
            platform,
          },
        });
      } catch (error) {
        if (error instanceof TypeError && error.message === 'fetch failed') {
          // Never retain or print the original error: its cause may include the
          // token-bearing request URL or payload. The POST outcome is unknown.
          throw new Error(
            `Telegram build upload notification transport failed; delivery outcome unknown: ${safeErrorDetails(error)}`,
          );
        }
        throw error;
      }
      if (telegramReceiptPath && !notification) {
        throw new Error('Telegram rejected the build upload notification');
      }
    }
  }

  const changelogConfigured =
    changelogRelativePath ||
    (config.upload && config.upload.changelog_path) ||
    null;
  if (changelogConfigured && telegram) {
    await deliverTelegramChangelog({
      projectRoot,
      changelogRelativePath: changelogConfigured,
      telegram: {
        ...telegram,
        topic_id: topicId,
      },
      appName,
      platform,
      version,
      receiptPath: telegramReceiptPath,
      receiptPrefix: 'incremental',
    });
  }

  if (additionalChangelogDeliveries.length) {
    for (const delivery of additionalChangelogDeliveries) {
      // No destination configured: the document is written, not sent.
      if (!delivery.telegram) continue;
      await deliverTelegramChangelog({
        projectRoot,
        changelogRelativePath: delivery.changelogRelativePath,
        telegram: delivery.telegram,
        appName,
        platform,
        version,
        label: delivery.label ?? 'additional changelog',
        documentTitle: delivery.documentTitle ?? 'Changelog',
        receiptPath: telegramReceiptPath,
        receiptPrefix: delivery.receiptPrefix ?? 'additional',
      });
    }
  }
}

export async function sendFailureTelegram({
  projectRoot,
  config,
  platform,
  errorMessage,
  topicIdOverride,
  telegramReceiptPath,
}) {
  const telegram = getTelegramSection(config);
  if (!telegram) return;

  const version = getVersion(projectRoot) ?? 'unknown';
  const topicId =
    topicIdOverride ||
    telegram.topic_id ||
    process.env.TELEGRAM_TOPIC_ID ||
    undefined;

  await sendTelegramMessage({
    botToken: telegram.bot_token,
    chatId: telegram.chat_id,
    topicId,
    text:
      `❌ <b>Build Failed</b>\n\n` +
      `Platform: ${platform}\n` +
      `Version: ${version}\n` +
      `Error: ${errorMessage ?? 'Unknown error'}`,
    receiptPath: telegramReceiptPath,
    receipt: {
      delivery: 'build_failure_notification',
      version,
      platform,
    },
  });
}

export async function performBuild({
  projectRoot,
  config,
  platform,
  update,
  changelogRelativePath,
  topicIdOverride,
  validateBuildArtifact,
  iosArchiveSigning,
  notes,
  additionalChangelogDeliveries,
  telegramReceiptPath,
  performUploadImpl = performUpload,
}) {
  let buildSuccess = false;
  let errorMessage;
  try {
    console.log(`Starting the build process for ${platform}...`);

    if (update) {
      let code = await runInherit(projectRoot, 'git', ['pull']);
      if (code !== 0) {
        console.warn(`Warning: git pull failed with exit code ${code}`);
      }
      code = await runInherit(projectRoot, 'git', ['submodule', 'update']);
      if (code !== 0) {
        console.warn(
          `Warning: git submodule update failed with exit code ${code}`,
        );
      }
      code = await runInherit(projectRoot, 'flutter', ['pub', 'get']);
      if (code !== 0) {
        throw new Error(`flutter pub get failed with exit code ${code}`);
      }
    }

    let buildExit;
    if (platform === 'ios') {
      const rel =
        (config.ios && config.ios.export_options_plist) ||
        'ios/ExportOptions.plist';
      const exportOptions = resolvePath(projectRoot, rel);
      const args = ['build', 'ipa'];
      if (fs.existsSync(exportOptions)) {
        args.push('--export-options-plist', exportOptions);
        console.log('Using ExportOptions.plist for IPA export');
      } else {
        console.warn(
          `Warning: ${rel} not found, building IPA without export options`,
        );
      }
      if (iosArchiveSigning) {
        console.log(`Archive signing: manual, ${iosArchiveSigning.certificate}, ${iosArchiveSigning.profile}`);
      }
      buildExit = await withIosArchiveSigning(iosArchiveSigning, (env) =>
        runInherit(projectRoot, 'flutter', args, { env }),
      );
    } else {
      console.log('Building Android APK for Play Store');
      buildExit = await runInherit(projectRoot, 'flutter', ['build', 'apk']);
    }

    if (buildExit !== 0) {
      throw new Error(`flutter build failed with exit code ${buildExit}`);
    }

    const artifact = findBuildArtifact(projectRoot, platform);
    if (!artifact.path) {
      throw new Error(artifact.missingMessage);
    }
    console.log(`${artifact.foundMessage}: ${artifact.path}`);

    if (validateBuildArtifact) {
      console.log('Validating the completed build artifact...');
      await validateBuildArtifact(artifact.path);
      console.log('Build artifact validation passed');
    }

    await performUploadImpl({
      projectRoot,
      config,
      platform,
      changelogRelativePath,
      topicIdOverride,
      buildFilePath: artifact.path,
      notes,
      additionalChangelogDeliveries,
      telegramReceiptPath,
    });

    console.log('Build and upload process completed successfully!');
    buildSuccess = true;
  } catch (e) {
    errorMessage = String(e?.message ?? e);
    console.error(`An error occurred during build: ${errorMessage}`);
    console.error(
      'Upload skipped because the build did not complete successfully.',
    );
  }

  if (!buildSuccess) {
    await sendFailureTelegram({
      projectRoot,
      config,
      platform,
      errorMessage,
      topicIdOverride,
      telegramReceiptPath,
    });
    process.exit(1);
  }
}
