import { BUILDPORT_BASE_URL } from './buildport-upload.mjs';

const CHECK_TIMEOUT_MS = 15000;

/**
 * Split a Flutter pubspec version "2.0.0+386" into marketing version and build
 * number. Returns null when the build number is missing, so nothing is checked.
 */
export function splitVersion(version) {
  const match = /^(\d+\.\d+\.\d+)\+(\d+)$/.exec(String(version ?? '').trim());
  return match ? { version: match[1], build: match[2] } : null;
}

function describeEntries(entries) {
  return entries
    .map((entry) => {
      const when = entry.uploaded_at
        ? ` (${String(entry.uploaded_at).slice(0, 10)})`
        : '';
      return `${entry.track || 'unknown track'}${when}`;
    })
    .join(', ');
}

/**
 * Ask BuildPort whether this app, platform, version and build number already
 * exist, before spending a long build on an upload BuildPort would refuse.
 * BuildPort enforces the rule at upload; this only fails early. Anything that
 * stops the question being answered (offline, a BuildPort error) is a warning,
 * never a failure: the upload then reports the real result.
 *
 * @returns {Promise<{ status: 'free'|'taken'|'skipped', entries?: object[], message?: string }>}
 */
export async function checkBuildNumber({
  version,
  platform,
  appGroup,
  apiToken,
  baseUrl = BUILDPORT_BASE_URL,
  fetchImpl = globalThis.fetch,
  warn = console.warn,
}) {
  const parts = splitVersion(version);
  if (!parts || !apiToken || (platform !== 'ios' && platform !== 'android')) {
    return { status: 'skipped' };
  }
  const query = new URLSearchParams({
    version: parts.version,
    build: parts.build,
    platform,
  });
  if (appGroup) query.set('app', appGroup);
  try {
    const response = await fetchImpl(`${baseUrl}/api/builds/check?${query}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) {
      warn(`Warning: could not check the build number on BuildPort (HTTP ${response.status}); continuing.`);
      return { status: 'skipped' };
    }
    const body = await response.json();
    if (!body.taken) return { status: 'free' };
    const entries = Array.isArray(body.entries) ? body.entries : [];
    return {
      status: 'taken',
      entries,
      message:
        `Build number ${version} is already on BuildPort for ${platform} (${describeEntries(entries) || 'another track'}). ` +
        'BuildPort refuses a different file with the same number, so this build would be rejected after it finishes. ' +
        'Use an unused number first: for Tunaipro run `python3 tool/tunaipro_build_number.py --repo . --reserve --adhoc`, ' +
        'then `tunai-build-script --bump-version manual <version>+<number>`.',
    };
  } catch (error) {
    warn(`Warning: could not check the build number on BuildPort (${error?.name || 'error'}); continuing.`);
    return { status: 'skipped' };
  }
}
