import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { getBuildportSection } from './config.mjs';

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

  if (!getBuildportSection(config)) {
    throw new Error(
      '--release-candidate requires buildport.api_token or BUILDPORT_API_TOKEN',
    );
  }

  const envOverrides = {
    ...requirePlainStringMap(
      channel.env_overrides,
      'channel.prod.env_overrides',
    ),
  };
  if (!Object.prototype.hasOwnProperty.call(envOverrides, 'TestVersion')) {
    throw new Error(
      'channel.prod.env_overrides.TestVersion must be configured as "false"',
    );
  }
  if (envOverrides.TestVersion.trim().toLowerCase() !== 'false') {
    throw new Error(
      'channel.prod.env_overrides.TestVersion must be "false"',
    );
  }

  const envPath = path.join(projectRoot, '.env');
  let envContent = '';
  const envFile = channel.env_file?.trim();
  if (envFile) {
    const sourcePath = resolveProjectPath(projectRoot, envFile);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`channel.prod.env_file not found: ${sourcePath}`);
    }
    envContent = fs.readFileSync(sourcePath, 'utf8');
  } else if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  envContent = applyDotEnvOverrides(envContent, envOverrides);

  if (
    readDotEnvValue(envContent, 'TestVersion')?.toLowerCase() !== 'false'
  ) {
    throw new Error(
      'Resolved production .env must contain TestVersion=false',
    );
  }

  const channelFile = path.join(
    projectRoot,
    'ios',
    'Flutter',
    'channel.xcconfig',
  );
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

  return {
    config: effectiveConfig,
    iosBundleId,
    iosDisplayName,
    exportOptionsPath,
    envPath,
    channelFile,
    tagPrefix,
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

  return { bundleId, displayName, testVersion };
}
