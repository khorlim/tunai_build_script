import { runGit, runProcess } from './changelog-git.mjs';

/**
 * @param {string} cwd repo root (main app or submodule)
 * @returns {Promise<string | null>}
 */
export async function getGitOriginUrl(cwd) {
  const r = await runGit(cwd, ['remote', 'get-url', 'origin']);
  if (r.code !== 0) return null;
  const u = r.stdout.trim();
  return u || null;
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
