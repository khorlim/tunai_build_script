import fs from 'fs';
import path from 'path';
import { runInherit } from './run.mjs';
import { getAppName, getVersion } from './pubspec.mjs';
import { getApphostSection, getTelegramSection } from './config.mjs';
import { findAndroidBuildFile, findIpaFile } from './artifacts.mjs';
import { uploadToApphost } from './apphost-upload.mjs';
import { sendTelegramDocument, sendTelegramMessage } from './telegram.mjs';

function resolvePath(projectRoot, rel) {
  if (!rel) return null;
  return path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
}

export async function performUpload({
  projectRoot,
  config,
  platform,
  changelogRelativePath,
  topicIdOverride,
}) {
  console.log(`Starting the upload process for ${platform}...`);

  const version = getVersion(projectRoot);
  if (!version) {
    console.error('Error: Could not find version in pubspec.yaml');
    process.exit(1);
  }

  const apphost = getApphostSection(config);
  if (!apphost) {
    console.error(
      'Error: Missing "apphost" in tunai_build_script_config.json',
    );
    process.exit(1);
  }

  let bundleIdentifier;
  let buildFilePath;

  if (platform === 'ios') {
    bundleIdentifier = apphost.ios_bundle_identifier;
    if (!bundleIdentifier) {
      console.error(
        'Error: apphost.ios_bundle_identifier missing in tunai_build_script_config.json',
      );
      process.exit(1);
    }
    const ipa = findIpaFile(projectRoot);
    if (!ipa) {
      console.error(
        'Error: Could not find IPA file in build/ios/ipa — build the iOS IPA first',
      );
      process.exit(1);
    }
    buildFilePath = ipa;
    console.log(`Found IPA file: ${buildFilePath}`);
  } else if (platform === 'android') {
    bundleIdentifier = apphost.android_package_name;
    if (!bundleIdentifier) {
      console.error(
        'Error: apphost.android_package_name missing in tunai_build_script_config.json',
      );
      process.exit(1);
    }
    const androidFile = findAndroidBuildFile(projectRoot);
    if (!androidFile) {
      console.error(
        'Error: Could not find AAB/APK under build/app/outputs — build Android first',
      );
      process.exit(1);
    }
    buildFilePath = androidFile;
    console.log(`Found Android build file: ${buildFilePath}`);
  } else {
    throw new Error(`Unknown platform: ${platform}`);
  }

  const installUrl = await uploadToApphost({
    platform,
    buildFilePath,
    version,
    bundleIdentifier,
    apphost: {
      user_id: String(apphost.user_id ?? ''),
      app_id: String(apphost.app_id ?? ''),
      key: String(apphost.key ?? ''),
    },
  });

  console.log('Upload completed successfully!');
  console.log('Install your app from:');
  console.log(installUrl);
  console.log('');

  const appName = getAppName(projectRoot) ?? 'App';
  const telegram = getTelegramSection(config);
  const topicId =
    topicIdOverride ||
    telegram?.topic_id ||
    process.env.TELEGRAM_TOPIC_ID ||
    undefined;

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

    await performUpload({
      projectRoot,
      config,
      platform,
      changelogRelativePath,
      topicIdOverride,
    });

    console.log('Build and upload process completed successfully!');
    buildSuccess = true;
  } catch (e) {
    errorMessage = String(e?.message ?? e);
    console.error(`An error occurred during build: ${errorMessage}`);
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
