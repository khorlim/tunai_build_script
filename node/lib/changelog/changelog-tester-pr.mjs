import path from 'path';
import {
  splitCommitBlock,
  extractPrNumberFromSubject,
  stripPrMarkerFromSubject,
  parseGithubRepoFromRemoteUrl,
} from './changelog-parse.mjs';
import { getGitOriginUrl, fetchGithubPullViaGh } from './changelog-github.mjs';

/**
 * @typedef {{ fetchPr: boolean, repoOverride: { owner: string, repo: string } | null, cache: Map<string, Awaited<ReturnType<typeof fetchGithubPullViaGh>>>, warn: (msg: string) => void }} GithubFetchContext
 */

/**
 * Tester changelog: one entry per unique PR number in git log order (newest first).
 * Uses `gh pr view` for title + body when GitHub context is available and fetch is enabled.
 *
 * @param {string[]} commitBlocks
 * @param {string[]} out
 * @param {{ gitCwd: string, github?: GithubFetchContext | null, projectRootForGithubOverride?: string | null }} opts
 *   When `gitCwd` equals `projectRootForGithubOverride`, `github.repoOverride` applies (main app). Submodules always use their own origin.
 * @returns {Promise<void>}
 */
export async function appendTesterPrOnlyEntriesAsync(commitBlocks, out, opts) {
  const gh = opts.github;
  const gitCwd = opts.gitCwd;
  const overrideRoot = opts.projectRootForGithubOverride ?? null;

  const fromOrigin = parseGithubRepoFromRemoteUrl(
    await getGitOriginUrl(gitCwd),
  );
  const ownerRepo =
    overrideRoot && path.resolve(gitCwd) === path.resolve(overrideRoot)
      ? gh?.repoOverride ?? fromOrigin
      : fromOrigin;

  let warnedNoOrigin = false;
  const hadPrMarkerInLog = commitBlocks.some((b) => {
    const { subject } = splitCommitBlock(b);
    return extractPrNumberFromSubject(subject) != null;
  });

  const seenPr = new Set();
  let count = 0;

  for (const block of commitBlocks) {
    const { subject, body } = splitCommitBlock(block);
    const prNum = extractPrNumberFromSubject(subject);
    if (prNum == null) continue;

    if (!ownerRepo) {
      if (!warnedNoOrigin && gh?.warn) {
        gh.warn(
          `Could not parse github.com origin for ${gitCwd}; skipping PR entries (need owner/repo for gh pr view).`,
        );
        warnedNoOrigin = true;
      }
      continue;
    }

    if (seenPr.has(prNum)) continue;
    seenPr.add(prNum);

    const fallbackTitle =
      stripPrMarkerFromSubject(subject).trim() || `PR #${prNum}`;
    let title = fallbackTitle;
    let description = '';

    if (gh?.fetchPr) {
      const cacheKey = `${ownerRepo.owner}/${ownerRepo.repo}#${prNum}`;
      let fetched = gh.cache.get(cacheKey);
      if (!fetched) {
        fetched = await fetchGithubPullViaGh(
          ownerRepo.owner,
          ownerRepo.repo,
          prNum,
        );
        gh.cache.set(cacheKey, fetched);
      }
      if (fetched.ok) {
        title = fetched.title.trim() || fallbackTitle;
        description = (fetched.body || '').trim();
      } else {
        gh.warn(
          `${ownerRepo.owner}/${ownerRepo.repo} PR #${prNum}: ${fetched.error}`,
        );
        title = fallbackTitle;
        description = body.trim();
      }
    } else {
      title = fallbackTitle;
      description = body.trim();
    }

    out.push(`### PR #${prNum} — ${title}`, '');
    if (description) {
      out.push(description, '');
    }
    out.push('');
    count += 1;
  }

  if (count === 0) {
    if (hadPrMarkerInLog && !ownerRepo) {
      out.push(
        '*(PR numbers appear in commit subjects but the repo origin is not github.com or could not be parsed; use `--github-repo owner/repo`.)*',
        '',
      );
    } else {
      out.push(
        '*(No PR-linked commits in this range. Squash subjects must include `(#number)`.)*',
        '',
      );
    }
  }
}
