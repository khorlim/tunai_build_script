import { readPubspec, getVersionFromPubspecContent } from '../pubspec.mjs';
import { runGit, getCurrentCommitSha } from './changelog-git.mjs';

/**
 * @param {string} projectRoot
 * @param {string} toTag
 * @param {Date} now
 */
export async function getReleaseVersionAndDate(projectRoot, toTag, now) {
  const pub = readPubspec(projectRoot);
  let version = toTag;
  if (toTag === 'HEAD') {
    if (pub) {
      const v = getVersionFromPubspecContent(pub.content);
      if (v) version = `v${v}`;
      else {
        const r = await runGit(projectRoot, ['rev-parse', '--short', 'HEAD']);
        version =
          r.code === 0 && r.stdout.trim() ? r.stdout.trim() : 'untagged';
      }
    } else {
      const r = await runGit(projectRoot, ['rev-parse', '--short', 'HEAD']);
      version =
        r.code === 0 && r.stdout.trim() ? r.stdout.trim() : 'untagged';
    }
  }
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const dateString = `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return { version, dateString };
}

/**
 * @param {string} projectRoot
 * @param {string} fromTag
 * @param {string} toTag
 */
export async function resolveChangelogRevisionLabels(
  projectRoot,
  fromTag,
  toTag,
) {
  const fromDisplay =
    fromTag === 'HEAD'
      ? await getCurrentCommitSha(projectRoot)
      : fromTag;
  const toDisplay =
    toTag === 'HEAD' ? await getCurrentCommitSha(projectRoot) : toTag;
  return { fromDisplay, toDisplay };
}
