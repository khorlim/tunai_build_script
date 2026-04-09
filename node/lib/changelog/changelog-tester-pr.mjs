import path from 'path';
import {
  splitCommitBlock,
  extractPrNumberFromSubject,
  stripPrMarkerFromSubject,
  parseGithubRepoFromRemoteUrl,
  demoteMarkdownHeadings,
} from './changelog-parse.mjs';
import {
  getGitOriginUrl,
  fetchGithubPullViaGh,
  prefetchGithubPullJobs,
  DEFAULT_GH_PR_FETCH_CONCURRENCY,
} from './changelog-github.mjs';

/**
 * @typedef {{ fetchPr: boolean, repoOverride: { owner: string, repo: string } | null, cache: Map<string, Awaited<ReturnType<typeof fetchGithubPullViaGh>>>, originUrlCache?: Map<string, string | null>, warn: (msg: string) => void }} GithubFetchContext
 */

/**
 * @param {string} gitCwd
 * @param {string | null | undefined} projectRootForGithubOverride
 * @param {GithubFetchContext | null | undefined} github
 * @returns {Promise<{ owner: string, repo: string } | null>}
 */
export async function resolveTesterGithubRepo(
  gitCwd,
  projectRootForGithubOverride,
  github,
) {
  const memo = github?.originUrlCache ?? null;
  const fromOrigin = parseGithubRepoFromRemoteUrl(
    await getGitOriginUrl(gitCwd, memo),
  );
  const overrideRoot = projectRootForGithubOverride ?? null;
  if (overrideRoot && path.resolve(gitCwd) === path.resolve(overrideRoot)) {
    return github?.repoOverride ?? fromOrigin;
  }
  return fromOrigin;
}

/**
 * Unique PR fetch jobs for one repo’s commit list (git log order preserved for first-seen keys only in map iteration — order not needed for prefetch).
 *
 * @param {string[]} commitBlocks
 * @param {{ owner: string, repo: string }} ownerRepo
 * @returns {{ key: string, owner: string, repo: string, pullNumber: number }[]}
 */
export function collectTesterPrFetchJobs(commitBlocks, ownerRepo) {
  /** @type {Map<string, { key: string, owner: string, repo: string, pullNumber: number }>} */
  const byKey = new Map();
  for (const block of commitBlocks) {
    const { subject } = splitCommitBlock(block);
    const pullNumber = extractPrNumberFromSubject(subject);
    if (pullNumber == null) continue;
    const key = `${ownerRepo.owner}/${ownerRepo.repo}#${pullNumber}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      key,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullNumber,
    });
  }
  return [...byKey.values()];
}

/**
 * Warm `github.cache` for every PR referenced in the main repo and updated submodules.
 *
 * @param {GithubFetchContext} github
 * @param {string} projectRoot
 * @param {string[]} mainCommits
 * @param {Awaited<ReturnType<import('./changelog-git.mjs').getSubmoduleDeltas>>} deltas
 * @param {number} [concurrency]
 */
export async function prefetchTesterPullMetadata(
  github,
  projectRoot,
  mainCommits,
  deltas,
  concurrency = DEFAULT_GH_PR_FETCH_CONCURRENCY,
) {
  if (!github?.fetchPr) return;
  /** @type {Map<string, { key: string, owner: string, repo: string, pullNumber: number }>} */
  const byKey = new Map();
  const mergeJobs = async (blocks, gitCwd) => {
    const ownerRepo = await resolveTesterGithubRepo(
      gitCwd,
      projectRoot,
      github,
    );
    if (!ownerRepo) return;
    for (const j of collectTesterPrFetchJobs(blocks, ownerRepo)) {
      byKey.set(j.key, j);
    }
  };
  await mergeJobs(mainCommits, projectRoot);
  for (const d of deltas) {
    if (d.kind === 'updated' && d.commits.length > 0) {
      await mergeJobs(d.commits, path.join(projectRoot, d.subPath));
    }
  }
  await prefetchGithubPullJobs(github.cache, [...byKey.values()], concurrency);
}

/**
 * Tester changelog: one entry per unique PR number in git log order (newest first).
 * Assumes `prefetchTesterPullMetadata` already ran when `github.fetchPr` is true (cache hits only).
 *
 * @param {string[]} commitBlocks
 * @param {string[]} out
 * @param {{ gitCwd: string, github?: GithubFetchContext | null, projectRootForGithubOverride?: string | null }} opts
 * @returns {Promise<void>}
 */
export async function appendTesterPrOnlyEntriesAsync(commitBlocks, out, opts) {
  const gh = opts.github;
  const gitCwd = opts.gitCwd;
  const overrideRoot = opts.projectRootForGithubOverride ?? null;

  const ownerRepo = await resolveTesterGithubRepo(
    gitCwd,
    overrideRoot,
    gh ?? undefined,
  );

  let warnedNoOrigin = false;
  const hadPrMarkerInLog = commitBlocks.some((b) => {
    const { subject } = splitCommitBlock(b);
    return extractPrNumberFromSubject(subject) != null;
  });

  const seenPr = new Set();
  let count = 0;
  /** PR titles use `####` so template `###` sections in the body become `#####`+. */
  const BODY_MIN_HEADING = 5;

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
      const fetched = gh.cache.get(cacheKey);
      if (fetched?.ok) {
        title = fetched.title.trim() || fallbackTitle;
        description = (fetched.body || '').trim();
      } else if (fetched && !fetched.ok) {
        gh.warn(
          `${ownerRepo.owner}/${ownerRepo.repo} PR #${prNum}: ${fetched.error}`,
        );
        title = fallbackTitle;
        description = body.trim();
      } else {
        const loaded = await fetchGithubPullViaGh(
          ownerRepo.owner,
          ownerRepo.repo,
          prNum,
        );
        gh.cache.set(cacheKey, loaded);
        if (loaded.ok) {
          title = loaded.title.trim() || fallbackTitle;
          description = (loaded.body || '').trim();
        } else {
          gh.warn(
            `${ownerRepo.owner}/${ownerRepo.repo} PR #${prNum}: ${loaded.error}`,
          );
          title = fallbackTitle;
          description = body.trim();
        }
      }
    } else {
      title = fallbackTitle;
      description = body.trim();
    }

    if (count > 0) {
      out.push('---', '');
    }

    out.push(`#### PR #${prNum} — ${title}`, '');
    if (description) {
      out.push(demoteMarkdownHeadings(description, BODY_MIN_HEADING), '');
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

export { DEFAULT_GH_PR_FETCH_CONCURRENCY };
