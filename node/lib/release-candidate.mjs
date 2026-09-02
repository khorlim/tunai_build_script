import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { archiveSigningFromExportOptions } from './ios-archive-signing.mjs';
import {
  getBuildportSection,
  getTelegramChangelogSummarySection,
  getTelegramSection,
} from './config.mjs';

function trimEnvValue(value) {
  const trimmed = String(value ?? '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function readDotEnvValue(content, key) {
  for (const line of String(content).split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/,
    );
    if (!match || match[1] !== key) continue;
    return trimEnvValue(match[2]);
  }
  return undefined;
}

export function applyDotEnvOverrides(content, overrides) {
  let lines = String(content).split(/\r?\n/);
  if (lines.at(-1) === '') lines = lines.slice(0, -1);

  for (const [key, rawValue] of Object.entries(overrides)) {
    const value = String(rawValue);
    const matcher = new RegExp(
      `^(\\s*(?:export\\s+)?)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`,
    );
    const index = lines.findIndex((line) => matcher.test(line));
    const nextLine = `${key}=${value}`;
    if (index >= 0) {
      lines[index] = nextLine;
    } else {
      lines.push(nextLine);
    }
  }

  return `${lines.join('\n')}\n`;
}

function requirePlainStringMap(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new Error(`${fieldName}.${key} must be a string`);
    }
  }
  return value;
}

function resolveProjectPath(projectRoot, configuredPath) {
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(projectRoot, configuredPath);
}

function parseCumulativeChangelogConfig(config, releaseCandidate) {
  const cumulative = releaseCandidate?.cumulative_changelog;
  if (cumulative === undefined) return null;
  if (
    !cumulative ||
    typeof cumulative !== 'object' ||
    Array.isArray(cumulative)
  ) {
    throw new Error(
      'release_candidate.cumulative_changelog must be an object',
    );
  }

  const fromTagPrefix =
    typeof cumulative.from_tag_prefix === 'string'
      ? cumulative.from_tag_prefix.trim()
      : '';
  if (!fromTagPrefix) {
    throw new Error(
      'release_candidate.cumulative_changelog.from_tag_prefix is required',
    );
  }

  const outputPath =
    typeof cumulative.path === 'string' ? cumulative.path.trim() : '';
  const normalizedOutputPath = outputPath ? path.normalize(outputPath) : '';
  if (
    !normalizedOutputPath ||
    path.isAbsolute(normalizedOutputPath) ||
    normalizedOutputPath === '..' ||
    normalizedOutputPath.startsWith(`..${path.sep}`) ||
    normalizedOutputPath === 'changelog.md' ||
    normalizedOutputPath === 'changelog_tester.md' ||
    path.extname(normalizedOutputPath).toLowerCase() !== '.md'
  ) {
    throw new Error(
      'release_candidate.cumulative_changelog.path must be a project-relative Markdown path',
    );
  }

  const destination = cumulative.telegram;
  if (
    !destination ||
    typeof destination !== 'object' ||
    Array.isArray(destination)
  ) {
    throw new Error(
      'release_candidate.cumulative_changelog.telegram must be an object',
    );
  }
  const chatId =
    typeof destination.chat_id === 'string'
      ? destination.chat_id.trim()
      : '';
  const topicId =
    typeof destination.topic_id === 'string'
      ? destination.topic_id.trim()
      : '';
  if (!chatId) {
    throw new Error(
      'release_candidate.cumulative_changelog.telegram.chat_id is required',
    );
  }
  if (!topicId) {
    throw new Error(
      'release_candidate.cumulative_changelog.telegram.topic_id is required',
    );
  }

  const primaryTelegram = getTelegramSection(config);
  if (!primaryTelegram) {
    throw new Error(
      'release_candidate.cumulative_changelog requires telegram.bot_token and the primary telegram destination',
    );
  }
  if (!getTelegramChangelogSummarySection(config)) {
    throw new Error(
      'release_candidate.cumulative_changelog requires telegram.changelog_summary.enabled=true',
    );
  }

  return {
    fromTagPrefix,
    outputPath: normalizedOutputPath,
    telegram: {
      bot_token: primaryTelegram.bot_token,
      chat_id: chatId,
      topic_id: topicId,
    },
  };
}

export function prepareChannelEnvironment({
  projectRoot,
  channel,
  channelName,
  expectedTestVersion,
  writeFile = true,
}) {
  const fieldName = `channel.${channelName}`;
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) {
    throw new Error(`${fieldName} is required`);
  }
  if (typeof expectedTestVersion !== 'boolean') {
    throw new Error('expectedTestVersion must be a boolean');
  }

  const expectedValue = String(expectedTestVersion);
  const envOverrides = {
    ...requirePlainStringMap(
      channel.env_overrides,
      `${fieldName}.env_overrides`,
    ),
  };
  if (!Object.prototype.hasOwnProperty.call(envOverrides, 'TestVersion')) {
    throw new Error(
      `${fieldName}.env_overrides.TestVersion must be configured as "${expectedValue}"`,
    );
  }
  if (envOverrides.TestVersion.trim().toLowerCase() !== expectedValue) {
    throw new Error(
      `${fieldName}.env_overrides.TestVersion must be "${expectedValue}"`,
    );
  }

  const defaultsPath = path.join(projectRoot, '.env.tunai.defaults');
  if (fs.existsSync(defaultsPath)) {
    const defaultsContent = fs.readFileSync(defaultsPath, 'utf8');
    if (readDotEnvValue(defaultsContent, 'TestVersion') !== undefined) {
      throw new Error(
        '.env.tunai.defaults must not define TestVersion; configure it per channel',
      );
    }
  }

  const envPath = path.join(projectRoot, '.env');
  let envContent = '';
  if (
    channel.env_file !== undefined &&
    typeof channel.env_file !== 'string'
  ) {
    throw new Error(`${fieldName}.env_file must be a string`);
  }
  const envFile = channel.env_file?.trim();
  if (envFile) {
    const sourcePath = resolveProjectPath(projectRoot, envFile);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`${fieldName}.env_file not found: ${sourcePath}`);
    }
    envContent = fs.readFileSync(sourcePath, 'utf8');
  } else if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  envContent = applyDotEnvOverrides(envContent, envOverrides);

  const resolvedTestVersion = readDotEnvValue(envContent, 'TestVersion');
  if (resolvedTestVersion?.toLowerCase() !== expectedValue) {
    throw new Error(
      `Resolved ${channelName} .env must contain TestVersion=${expectedValue}`,
    );
  }

  if (writeFile) {
    fs.writeFileSync(envPath, envContent, 'utf8');
  }

  return {
    envPath,
    envContent,
    testVersion: resolvedTestVersion,
  };
}

export function prepareReleaseCandidate({
  projectRoot,
  config,
  platform,
  writeFiles = true,
}) {
  if (platform !== 'ios') {
    throw new Error(
      '--release-candidate currently supports ios only',
    );
  }

  const channel = config?.channel?.prod;
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) {
    throw new Error(
      'channel.prod is required for --release-candidate',
    );
  }

  const iosBundleId = channel.ios_bundle_id?.trim();
  if (!iosBundleId) {
    throw new Error(
      'channel.prod.ios_bundle_id is required for --release-candidate ios',
    );
  }
  const iosDisplayName = channel.ios_display_name?.trim();
  if (!iosDisplayName || /[\r\n]/.test(iosDisplayName)) {
    throw new Error(
      'channel.prod.ios_display_name is required for --release-candidate ios',
    );
  }

  const exportOptionsRel =
    channel.ios_export_options_plist?.trim();
  if (!exportOptionsRel) {
    throw new Error(
      'channel.prod.ios_export_options_plist is required for --release-candidate ios',
    );
  }
  const exportOptionsPath = resolveProjectPath(projectRoot, exportOptionsRel);
  if (!fs.existsSync(exportOptionsPath)) {
    throw new Error(
      `Release-candidate export options not found: ${exportOptionsPath}`,
    );
  }
  const exportOptions = JSON.parse(
    runCommand('plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      exportOptionsPath,
    ]),
  );
  if (
    exportOptions.method !== 'ad-hoc' &&
    exportOptions.method !== 'release-testing'
  ) {
    throw new Error(
      'Release-candidate iOS export method must be ad-hoc or release-testing',
    );
  }
  if (!exportOptions.provisioningProfiles?.[iosBundleId]) {
    throw new Error(
      `Release-candidate export options must map a provisioning profile for ${iosBundleId}`,
    );
  }

  const archiveSigning = archiveSigningFromExportOptions(
    exportOptions,
    iosBundleId,
    channel.ios_target ?? 'Runner',
  );

  const buildport = getBuildportSection(config);
  if (!buildport) {
    throw new Error(
      '--release-candidate requires buildport.api_token or BUILDPORT_API_TOKEN',
    );
  }

  const { envPath, envContent } = prepareChannelEnvironment({
    projectRoot,
    channel,
    channelName: 'prod',
    expectedTestVersion: false,
    writeFile: false,
  });

  const channelFile = path.join(
    projectRoot,
    'ios',
    'Flutter',
    'channel.xcconfig',
  );
  const releaseCandidate = config.release_candidate;
  if (
    releaseCandidate !== undefined &&
    (!releaseCandidate ||
      typeof releaseCandidate !== 'object' ||
      Array.isArray(releaseCandidate))
  ) {
    throw new Error('release_candidate must be an object');
  }
  if (
    releaseCandidate &&
    Object.prototype.hasOwnProperty.call(releaseCandidate, 'tag_prefix') &&
    typeof releaseCandidate.tag_prefix !== 'string'
  ) {
    throw new Error('release_candidate.tag_prefix must be a string');
  }
  const tagPrefix =
    releaseCandidate &&
    Object.prototype.hasOwnProperty.call(releaseCandidate, 'tag_prefix')
      ? releaseCandidate.tag_prefix
      : 'release-candidate';
  const cumulativeChangelog = parseCumulativeChangelogConfig(
    config,
    releaseCandidate,
  );

  const effectiveConfig = {
    ...config,
    upload: {
      ...(config.upload ?? {}),
      provider: 'buildport',
      providers: {
        ...(config.upload?.providers ?? {}),
        [platform]: 'buildport',
      },
    },
    ios: {
      ...(config.ios ?? {}),
      export_options_plist: exportOptionsRel,
    },
  };

  if (writeFiles) {
    fs.mkdirSync(path.dirname(channelFile), { recursive: true });
    fs.writeFileSync(
      channelFile,
      `// Written by tunai-build-script (--release-candidate). Do not commit.\n` +
        `PRODUCT_BUNDLE_IDENTIFIER = ${iosBundleId}\n` +
        `APP_DISPLAY_NAME = ${iosDisplayName}\n`,
      'utf8',
    );
    fs.writeFileSync(envPath, envContent, 'utf8');
  }

  return {
    config: effectiveConfig,
    iosBundleId,
    iosDisplayName,
    exportOptionsPath,
    archiveSigning,
    envPath,
    channelFile,
    tagPrefix,
    cumulativeChangelog,
    buildportAppGroup: buildport.app_group,
  };
}

function runCommand(command, args, options = {}) {
  const encoding = Object.prototype.hasOwnProperty.call(options, 'encoding')
    ? options.encoding
    : 'utf8';
  const result = spawnSync(command, args, {
    encoding,
    input: options.input,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${String(result.stderr ?? '').trim()}`,
    );
  }
  return result.stdout;
}

export function validateIosReleaseCandidateArtifact({
  ipaPath,
  expectedBundleId,
  expectedDisplayName,
}) {
  const listing = runCommand('unzip', ['-Z1', ipaPath]);
  const entries = String(listing).split(/\r?\n/).filter(Boolean);
  const infoPlistEntry = entries.find((entry) =>
    /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry),
  );
  if (!infoPlistEntry) {
    throw new Error('Release-candidate IPA has no app Info.plist');
  }

  const infoPlist = runCommand(
    'unzip',
    ['-p', ipaPath, infoPlistEntry],
    { encoding: null },
  );
  const bundleId = String(
    runCommand(
      'plutil',
      ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', '-'],
      { input: infoPlist },
    ),
  ).trim();
  if (bundleId !== expectedBundleId) {
    throw new Error(
      `Release-candidate IPA bundle id is "${bundleId}", expected "${expectedBundleId}"`,
    );
  }
  const displayName = String(
    runCommand(
      'plutil',
      ['-extract', 'CFBundleDisplayName', 'raw', '-o', '-', '-'],
      { input: infoPlist },
    ),
  ).trim();
  if (displayName !== expectedDisplayName) {
    throw new Error(
      `Release-candidate IPA display name is "${displayName}", expected "${expectedDisplayName}"`,
    );
  }

  const envEntry = entries.find((entry) =>
    /\/flutter_assets\/\.env$/.test(entry),
  );
  if (!envEntry) {
    throw new Error(
      'Release-candidate IPA does not contain flutter_assets/.env',
    );
  }
  const envContent = runCommand('unzip', ['-p', ipaPath, envEntry]);
  const testVersion = readDotEnvValue(envContent, 'TestVersion');
  if (testVersion?.toLowerCase() !== 'false') {
    throw new Error(
      `Release-candidate IPA must contain TestVersion=false, got "${testVersion ?? 'missing'}"`,
    );
  }

  const defaultsEntry = entries.find((entry) =>
    /\/flutter_assets\/\.env\.tunai\.defaults$/.test(entry),
  );
  if (defaultsEntry) {
    const defaultsContent = runCommand('unzip', [
      '-p',
      ipaPath,
      defaultsEntry,
    ]);
    if (readDotEnvValue(defaultsContent, 'TestVersion') !== undefined) {
      throw new Error(
        'Release-candidate IPA defaults must not define TestVersion',
      );
    }
  }

  return { bundleId, displayName, testVersion };
}
