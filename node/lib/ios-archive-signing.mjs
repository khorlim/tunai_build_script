import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function archiveSigningFromExportOptions(exportOptions, bundleId, target = 'Runner', extensionTargets = {}) {
  if (exportOptions.signingStyle !== 'manual') {
    throw new Error('Release-candidate export options must use manual signing');
  }
  if (!extensionTargets || typeof extensionTargets !== 'object' || Array.isArray(extensionTargets)) {
    throw new Error('ios_extension_targets must map extension bundle IDs to Xcode target names');
  }
  const signing = {
    target,
    teamId: exportOptions.teamID,
    certificate: exportOptions.signingCertificate,
    profile: exportOptions.provisioningProfiles?.[bundleId],
  };
  const additionalTargets = Object.create(null);
  for (const [extensionId, extensionTarget] of Object.entries(extensionTargets)) {
    if (extensionId === bundleId || extensionTarget === target || Object.hasOwn(additionalTargets, extensionTarget)) {
      throw new Error('Archive signing targets must be unique');
    }
    additionalTargets[extensionTarget] = exportOptions.provisioningProfiles?.[extensionId];
  }
  for (const exportedId of Object.keys(exportOptions.provisioningProfiles ?? {})) {
    if (exportedId !== bundleId && !Object.hasOwn(extensionTargets, exportedId)) {
      throw new Error(`No Xcode target mapping for exported extension ${exportedId}`);
    }
  }
  if (Object.keys(additionalTargets).length) signing.additionalTargets = additionalTargets;
  // Validate before release preparation can bump, commit, or push anything.
  renderArchiveSigning(signing);
  assertNoSigningOverride(process.env);
  return signing;
}

export function renderArchiveSigning({ target, teamId, certificate, profile, additionalTargets = {} }) {
  if (typeof target !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
    throw new Error('Archive signing target must be a simple Xcode target name');
  }
  if (typeof teamId !== 'string' || !/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error('Release-candidate export options must specify a valid teamID');
  }
  if (typeof certificate !== 'string' ||
      !/^(Apple Distribution|iPhone Distribution|[A-Fa-f0-9]{40})$/.test(certificate)) {
    throw new Error('Release-candidate signingCertificate must select a distribution identity');
  }
  // xcconfig is executable configuration: reject expansions, comments and new lines.
  if (typeof profile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/.test(profile)) {
    throw new Error('Release-candidate provisioning profile name is missing or unsafe');
  }
  const extensionLines = Object.entries(additionalTargets).map(([extensionTarget, extensionProfile]) => {
    if (extensionTarget === target) throw new Error('Archive signing targets must be unique');
    // Reuse all xcconfig validation for every extension before writing any files.
    renderArchiveSigning({ target: extensionTarget, teamId, certificate, profile: extensionProfile });
    return `TUNAI_ARCHIVE_PROFILE_${extensionTarget} = ${extensionProfile}`;
  });
  return [
    '// Temporary archive-only settings; no project files are modified.',
    'CODE_SIGN_STYLE = Manual',
    `CODE_SIGN_IDENTITY = ${certificate}`,
    `CODE_SIGN_IDENTITY[sdk=iphoneos*] = ${certificate}`,
    `DEVELOPMENT_TEAM = ${teamId}`,
    `TUNAI_ARCHIVE_PROFILE_${target} = ${profile}`,
    ...extensionLines,
    // Xcode expands this per target. Pods must not inherit Runner's profile.
    'PROVISIONING_PROFILE_SPECIFIER = $(TUNAI_ARCHIVE_PROFILE_$(TARGET_NAME))',
    'PROVISIONING_PROFILE =',
    '',
  ].join('\n');
}

function assertNoSigningOverride(env) {
  if (env.XCODE_XCCONFIG_FILE) {
    throw new Error('Unset XCODE_XCCONFIG_FILE before building a release candidate');
  }
}

export async function withIosArchiveSigning(signing, run, env = process.env) {
  if (!signing) return run(env);
  assertNoSigningOverride(env);
  const contents = renderArchiveSigning(signing);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tunai-archive-signing-'));
  try {
    const configPath = path.join(directory, 'archive.xcconfig');
    fs.writeFileSync(configPath, contents, { mode: 0o600 });
    return await run({ ...env, XCODE_XCCONFIG_FILE: configPath });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
