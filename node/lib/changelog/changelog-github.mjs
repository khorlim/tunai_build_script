import path from 'path';
import { runGit, runProcess } from './changelog-git.mjs';

/** Concurrent `gh pr view` processes (each spawn has overhead; too high can hit rate limits). */
export const DEFAULT_GH_PR_FETCH_CONCURRENCY = 8;

/**
 * @param {string} cwd repo root (main app or submodule)
 * @param {Map<string, string | null> | null} [memo] resolved path → URL (or null); avoids repeated `git remote` per repo
 * @returns {Promise<string | null>}
 */
export async function getGitOriginUrl(cwd, memo = null) {
  const key = path.resolve(cwd);
  if (memo?.has(key)) return memo.get(key) ?? null;
  const r = await runGit(cwd, ['remote', 'get-url', 'origin']);
  if (r.code !== 0) {
    memo?.set(key, null);
    return null;
  }
  const u = r.stdout.trim() || null;
  memo?.set(key, u);
  return u;
}

/** Cached result for one process run (CLI). */
let ghAuthOkCache = /** @type {boolean | null} */ (null);

/**
 * Whether `gh auth status` succeeds (logged in). Caches per process.
 * @returns {Promise<boolean>}
 */
export async function checkGhCliAuthenticated() {
  if (ghAuthOkCache !== null) return ghAuthOkCache;
  const r = await runProcess(null, 'gh', ['auth', 'status']);
  ghAuthOkCache = r.code === 0;
  return ghAuthOkCache;
}

/**
 * Uses GitHub CLI (`gh pr view`). Respects `gh auth login` and GH_HOST for Enterprise.
 * @param {string} owner
 * @param {string} repo
 * @param {number} pullNumber
 * @returns {Promise<{ ok: true, title: string, body: string } | { ok: false, error: string }>}
 */
export async function fetchGithubPullViaGh(owner, repo, pullNumber) {
  const repoSpec = `${owner}/${repo}`;
  const args = [
    'pr',
    'view',
    String(pullNumber),
    '--repo',
    repoSpec,
    '--json',
    'title,body',
  ];
  const r = await runProcess(null, 'gh', args);
  if (r.code !== 0) {
    const hint =
      /ENOENT|not found|spawn|executable/i.test(r.stderr || '')
        ? ' (install GitHub CLI and run gh auth login)'
        : '';
    return {
      ok: false,
      error: `${(r.stderr || r.stdout).trim() || `exit ${r.code}`}${hint}`,
    };
  }
  try {
    const data = JSON.parse(r.stdout);
    const title =
      data.title === null || data.title === undefined
        ? ''
        : String(data.title);
    const body =
      data.body === null || data.body === undefined ? '' : String(data.body);
    return { ok: true, title, body };
  } catch {
    return { ok: false, error: 'gh returned invalid JSON' };
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {number} pullNumber
 * @returns {Promise<{ ok: true, body: string } | { ok: false, error: string }>}
 */
export async function fetchGithubPullBodyViaGh(owner, repo, pullNumber) {
  const r = await fetchGithubPullViaGh(owner, repo, pullNumber);
  if (r.ok) return { ok: true, body: r.body };
  return { ok: false, error: r.error };
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<void>} fn
 */
export async function runPool(items, concurrency, fn) {
  if (items.length === 0) return;
  const n = Math.max(1, Math.min(concurrency, items.length));
  let ix = 0;
  async function worker() {
    while (true) {
      const i = ix++;
      if (i >= items.length) break;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
}

/**
 * Fill `cache` with `fetchGithubPullViaGh` results for jobs missing keys. Runs up to `concurrency` fetches at once.
 *
 * @param {Map<string, Awaited<ReturnType<typeof fetchGithubPullViaGh>>>} cache
 * @param {{ key: string, owner: string, repo: string, pullNumber: number }[]} jobs
 * @param {number} [concurrency]
 */
export async function prefetchGithubPullJobs(cache, jobs, concurrency) {
  const limit = concurrency ?? DEFAULT_GH_PR_FETCH_CONCURRENCY;
  const pending = jobs.filter((j) => !cache.has(j.key));
  await runPool(pending, limit, async (j) => {
    if (cache.has(j.key)) return;
    const fetched = await fetchGithubPullViaGh(j.owner, j.repo, j.pullNumber);
    cache.set(j.key, fetched);
  });
}
