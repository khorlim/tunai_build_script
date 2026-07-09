import fs from 'fs';
import path from 'path';
import { getAppInfo } from './app-info.mjs';
import { runInherit } from './run.mjs';
import { getVersion } from './pubspec.mjs';
import {
  getApphostSection,
  getBuildportSection,
  getLoadlySection,
  getTelegramSection,
} from './config.mjs';
import { findAndroidBuildFile, findIpaFile } from './artifacts.mjs';
import { uploadToApphost } from './apphost-upload.mjs';
import { collectBuildportChanges } from './buildport-changes.mjs';
import { uploadToBuildport } from './buildport-upload.mjs';
import { uploadToLoadly } from './loadly-upload.mjs';
import { sendTelegramDocument, sendTelegramMessage } from './telegram.mjs';

function resolvePath(projectRoot, rel) {
  if (!rel) return null;
  return path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
}

function resolveUploadProvider(config, platform) {
  const providers = config?.upload?.providers;
  const byPlatform =
    providers && typeof providers === 'object'
      ? providers[platform]
      : undefined;
  const raw = byPlatform ?? config?.upload?.provider ?? 'apphost';
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
}) {
  console.log(`Starting the upload process for ${platform}...`);

  const version = getVersion(projectRoot);
  if (!version) {
    console.error('Error: Could not find version in pubspec.yaml');
    process.exit(1);
  }

  const provider = resolveUploadProvider(config, platform);
  if (
    provider !== 'apphost' &&
    provider !== 'buildport' &&
    provider !== 'loadly' &&
    provider !== 'telegram_apk'
  ) {
    console.error(
      `Error: upload provider must be "apphost", "buildport", "loadly", or "telegram_apk", got "${provider}"`,
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
    });
    console.log('Telegram APK delivery completed successfully!');
  } else {
    let installUrl;
    if (provider === 'buildport') {
      const buildport = getBuildportSection(config);
      if (!buildport) {
        console.error(
          'Error: upload provider is "buildport" but buildport.api_token or BUILDPORT_API_TOKEN is missing',
        );
        process.exit(1);
      }
      const changes = await collectBuildportChanges({
        projectRoot,
        changesPath: buildport.changes_path,
        warn: (msg) => console.warn(`Warning: ${msg}`),
      });
      if (changes.length) {
        console.log(
          `Sending ${changes.length} change${changes.length === 1 ? '' : 's'} from the tester changelog to Buildport`,
        );
      }
      installUrl = await uploadToBuildport({
        buildFilePath: resolvedBuildFilePath,
        version,
        appInfo,
        buildport,
        changes,
      });
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
    } else {
      const apphost = getApphostSection(config);
      if (!apphost) {
        console.error(
          'Error: Missing "apphost" in tunai_build_script_config.json',
        );
        process.exit(1);
      }

      let bundleIdentifier;
      if (platform === 'ios') {
        bundleIdentifier = apphost.ios_bundle_identifier;
        if (!bundleIdentifier) {
          console.error(
            'Error: apphost.ios_bundle_identifier missing in tunai_build_script_config.json',
          );
          process.exit(1);
        }
      } else {
        bundleIdentifier = apphost.android_package_name;
        if (!bundleIdentifier) {
          console.error(
            'Error: apphost.android_package_name missing in tunai_build_script_config.json',
          );
          process.exit(1);
        }
      }

      installUrl = await uploadToApphost({
        platform,
        buildFilePath: resolvedBuildFilePath,
        version,
        bundleIdentifier,
        apphost: {
          user_id: String(apphost.user_id ?? ''),
          app_id: String(apphost.app_id ?? ''),
          key: String(apphost.key ?? ''),
        },
      });
    }

    console.log('Upload completed successfully!');
    console.log('Install your app from:');
    console.log(installUrl);
    console.log('');

    if (telegram) {
      await sendTelegramMessage({
        botToken: telegram.bot_token,
        chatId: telegram.chat_id,
        topicId,
        text:
          `✅ <b>Build & Upload Completed Successfully</b>\n\n` +
          `App: ${appName}\n` +
          `Platform: ${platform}\n` +
          `Version: ${version}\n\n` +
          `📱 <b>Install URL:</b>\n${installUrl}`,
      });
    }
  }

  const changelogConfigured =
    changelogRelativePath ||
    (config.upload && config.upload.changelog_path) ||
    null;
  if (changelogConfigured && telegram) {
    const changelogFile = resolvePath(projectRoot, changelogConfigured);
    if (changelogFile && fs.existsSync(changelogFile)) {
      console.log(`Uploading changelog file: ${changelogFile}`);
      await sendTelegramDocument({
        botToken: telegram.bot_token,
        chatId: telegram.chat_id,
        filePath: changelogFile,
        topicId,
        caption:
          `📝 Changelog\n\nApp: ${appName}\nPlatform: ${platform}\nVersion: ${version}`,
      });
    } else {
      console.warn(
        `Warning: Changelog file not found: ${changelogFile || changelogConfigured}`,
      );
    }
  }
}

export async function sendFailureTelegram({
  projectRoot,
  config,
  platform,
  errorMessage,
  topicIdOverride,
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
  });
}

export async function performBuild({
  projectRoot,
  config,
  platform,
  update,
  changelogRelativePath,
  topicIdOverride,
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
      const exportOptions = path.join(projectRoot, rel);
      const args = ['build', 'ipa'];
      if (fs.existsSync(exportOptions)) {
        args.push('--export-options-plist', exportOptions);
        console.log('Using ExportOptions.plist for IPA export');
      } else {
        console.warn(
          `Warning: ${rel} not found, building IPA without export options`,
        );
      }
      buildExit = await runInherit(projectRoot, 'flutter', args);
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

    await performUpload({
      projectRoot,
      config,
      platform,
      changelogRelativePath,
      topicIdOverride,
      buildFilePath: artifact.path,
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
    });
    process.exit(1);
  }
}
