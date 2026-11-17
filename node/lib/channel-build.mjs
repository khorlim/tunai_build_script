import { performBuild } from './build.mjs';
import {
  prepareIosChannel,
  validateIosReleaseCandidateArtifact,
} from './release-candidate.mjs';
import { getBuildportSection } from './config.mjs';

export const CHANNELS = {
  test: { expectedTestVersion: true },
  prod: { expectedTestVersion: false },
};

/**
 * Validate and apply a channel for a plain iOS build (`--platform ios
 * --channel <test|prod>`). Reuses the release-candidate channel preparation, so
 * the channel files, env overrides, archive signing and export-options checks
 * are identical. Never bumps, commits, tags, pushes or touches Telegram: the
 * only files written are the ignored channel files, returned in `writtenFiles`.
 */
export function prepareChannelBuild({
  projectRoot,
  config,
  channelName,
  writeFiles = true,
}) {
  if (!Object.hasOwn(CHANNELS, channelName)) {
    throw new Error('--channel must be test or prod');
  }
  if (!config?.channel?.[channelName]) {
    throw new Error(`channel.${channelName} is required for --channel`);
  }
  if (!getBuildportSection(config)) {
    throw new Error(
      '--channel requires buildport.api_token or BUILDPORT_API_TOKEN',
    );
  }
  const channel = prepareIosChannel({
    projectRoot,
    config,
    channelName,
    expectedTestVersion: CHANNELS[channelName].expectedTestVersion,
    modeLabel: '--channel',
    writtenBy: `--channel ${channelName}`,
    writeFiles,
  });

  // Branch builds are delivered through BuildPort only, and nothing is sent to
  // Telegram: drop the section so neither upload nor failure paths can use it.
  const { telegram: _telegram, ...rest } = config;
  const effectiveConfig = {
    ...rest,
    upload: {
      ...(config.upload ?? {}),
      provider: 'buildport',
      providers: { ...(config.upload?.providers ?? {}), ios: 'buildport' },
    },
    ios: { ...(config.ios ?? {}), export_options_plist: channel.exportOptionsRel },
  };

  return {
    ...channel,
    channelName,
    config: effectiveConfig,
    writtenFiles: writeFiles ? [channel.envPath, channel.channelFile] : [],
  };
}

/**
 * Run an iOS build with a channel applied. `performBuildImpl` is injectable
 * for tests.
 */
export async function runChannelBuild({
  projectRoot,
  config,
  channelName,
  update,
  notes,
  dryRun = false,
  performBuildImpl = performBuild,
  log = console.log,
}) {
  const channel = prepareChannelBuild({
    projectRoot,
    config,
    channelName,
    writeFiles: !dryRun,
  });
  log(`Channel: ${channelName} bundle id ${channel.iosBundleId}`);
  log(`Channel display name: ${channel.iosDisplayName}`);
  log(`Channel environment: TestVersion=${channel.testVersion}`);
  log(
    `iOS archive signing: manual, ${channel.archiveSigning.certificate}, ${channel.archiveSigning.profile}`,
  );
  log('Distribution: BuildPort (no version bump, changelog, commit, tag, push or Telegram)');
  if (dryRun) {
    log('Dry run: no channel files written, nothing built.');
    return channel;
  }
  log('Channel files written (ignored by git):');
  for (const file of channel.writtenFiles) log(`  ${file}`);

  await performBuildImpl({
    projectRoot,
    config: channel.config,
    iosArchiveSigning: channel.archiveSigning,
    platform: 'ios',
    update,
    changelogRelativePath: null,
    notes,
    validateBuildArtifact: (ipaPath) =>
      validateIosReleaseCandidateArtifact({
        ipaPath,
        expectedBundleId: channel.iosBundleId,
        expectedDisplayName: channel.iosDisplayName,
        expectedTestVersion: channel.testVersion.toLowerCase() === 'true',
      }),
  });
  return channel;
}
