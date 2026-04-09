#!/usr/bin/env node
/**
 * Generate changelog.md (engineering) and changelog_tester.md from git history.
 * Tester doc: full squash commit body per change; if the body is empty and the subject has `(#N)`, loads the full PR body via **GitHub CLI** (`gh pr view`) when `gh auth login` is OK;
 * if `gh` is missing or not logged in, logs a warning and skips PR fetch. Use **--no-fetch-github-pr** to skip network entirely.
 * Submodules use that submodule's `git remote get-url origin`. Requires git on PATH.
 *
 * Usage:
 *   node node/lib/generate-changelog.mjs [fromRev] [toRev]
 *   node node/lib/generate-changelog.mjs --from v1.0.0 --to HEAD --output CHANGELOG.release.md
 *   node node/lib/generate-changelog.mjs --project-root /path/to/flutter/app
 *   node node/lib/generate-changelog.mjs --git-root .   # any git repo, no pubspec required
 *
 * Non-interactive (no TTY): missing from/to default to last tag → HEAD (or HEAD → HEAD if no tags).
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { readPubspec, getVersionFromPubspecContent } from './pubspec.mjs';

/** Record/field delimiters for `git log --format`. Do not use \\x01/\\x02 in subjects or bodies or parsing will split incorrectly. */
const RECORD_START = '\x01';
const FIELD_SEP = '\x02';

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code: signal ? 1 : code ?? 1, stdout, stderr });
    });
  });
}

/**
 * @param {string | null} cwd
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runProcess(cwd, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: cwd ?? undefined,
      shell: false,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      resolve({
        code: 127,
        stdout: '',
        stderr: String(err?.message ?? err),
      });
    });
    child.on('close', (code, signal) => {
      resolve({ code: signal ? 1 : code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Resolve Flutter project root: walk up from startDir for pubspec.yaml;
 * if script lives in tool/, also try parent of tool/.
 * @param {{ startDir?: string, scriptFile?: string | null }} [options]
 * @returns {string | null}
 */
export function resolveFlutterProjectRoot(options = {}) {
  const startDir = path.resolve(options.startDir ?? process.cwd());
  const scriptFile = options.scriptFile ?? null;

  const tryDir = (dir) => {
    const d = path.resolve(dir);
    if (fs.existsSync(path.join(d, 'pubspec.yaml'))) return d;
    return null;
  };

  const candidates = [];
  candidates.push(startDir);
  if (scriptFile) {
    const scriptDir = path.dirname(path.resolve(scriptFile));
    if (path.basename(scriptDir) === 'tool') {
      candidates.push(path.dirname(scriptDir));
    }
  }

  for (const c of candidates) {
    const found = tryDir(c);
    if (found) return found;
  }

  let dir = startDir;
  const root = path.parse(dir).root;
  while (true) {
    const found = tryDir(dir);
    if (found) return found;
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * @param {string} output
 * @returns {string[]} each entry: first line "shortSha subject", optional body lines
 */
export function parseFormattedLogOutput(output) {
  const parts = output.split(RECORD_START);
  /** @type {string[]} */
  const commits = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const fields = trimmed.split(FIELD_SEP);
    if (fields.length < 2) continue;
    const shortSha = fields[0].trim();
    const subject = fields[1].trim();
    const body =
      fields.length > 2 ? fields.slice(2).join(FIELD_SEP).trim() : '';
    const firstLine = `${shortSha} ${subject}`;
    if (!body) {
      commits.push(firstLine);
    } else {
      const bodyLines = body
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 0 && !l.toLowerCase().startsWith('co-authored-by:'),
        );
      let block = firstLine;
      for (const line of bodyLines) {
        block += `\n${line}`;
      }
      commits.push(block);
    }
  }
  return commits;
}

/**
 * @param {string} projectRoot
 * @param {string} fromRev
 * @param {string} toRev
 * @param {string | null} [gitWorkingDir] submodule path → git -C
 * @param {{ onGitError?: (info: { args: string[], stderr: string }) => void }} [opts]
 * @returns {Promise<string[]>}
 */
export async function getFormattedLogCommits(
  projectRoot,
  fromRev,
  toRev,
  gitWorkingDir = null,
  opts = {},
) {
  const args = [
    ...(gitWorkingDir ? ['-C', gitWorkingDir] : []),
    'log',
    `${fromRev}..${toRev}`,
    '--no-merges',
    `--format=${RECORD_START}%h${FIELD_SEP}%s${FIELD_SEP}%b`,
  ];
  const spawnCwd = gitWorkingDir ?? projectRoot;
  const result = await runGit(spawnCwd, args);
  if (result.code !== 0) {
    opts.onGitError?.({ args, stderr: result.stderr });
    return [];
  }
  return parseFormattedLogOutput(result.stdout);
}

const H3 = /^###\s*(.+?)\s*$/;

/**
 * Extract `### User Visible Changes` and `### Risk Level` blocks (case-insensitive). Not used for tester changelog output (that uses the full body); kept for callers who want structured fields.
 * @param {string} body
 * @returns {{ userVisible: string | null, riskLevel: string | null }}
 */
export function extractPrTesterSections(body) {
  if (!body?.trim()) return { userVisible: null, riskLevel: null };
  const lines = body.split('\n');
  /** @type {'userVisible' | 'riskLevel' | null} */
  let collecting = null;
  const uv = [];
  const risk = [];
  for (const line of lines) {
    const hm = line.match(H3);
    if (hm) {
      const title = hm[1].trim().toLowerCase();
      if (title === 'user visible changes') {
        collecting = 'userVisible';
        continue;
      }
      if (title === 'risk level') {
        collecting = 'riskLevel';
        continue;
      }
      collecting = null;
      continue;
    }
    if (collecting === 'userVisible') uv.push(line);
    else if (collecting === 'riskLevel') risk.push(line);
  }
  const trimBlock = (arr) => {
    const s = arr.join('\n').replace(/\s+$/u, '').trim();
    return s.length > 0 ? s : null;
  };
  return {
    userVisible: trimBlock(uv),
    riskLevel: trimBlock(risk),
  };
}

/**
 * @param {string} commitBlock first line `shortSha subject`, optional following body lines
 * @returns {{ shortSha: string, subject: string, firstLine: string, body: string }}
 */
export function splitCommitBlock(commitBlock) {
  const lines = commitBlock.split('\n');
  const firstLine = lines[0].trim();
  // Allow ASCII space or en/em dash between shortSha and subject (git uses space; pasted lines may use —).
  const m = firstLine.match(
    /^([0-9a-f]{4,40})(?:\s+|\s*[\u2013\u2014]\s+)(.+)$/iu,
  );
  const shortSha = m ? m[1] : '';
  const subject = m
    ? m[2]
        .trim()
        .replace(/^[\u2013\u2014\-–]\s*/u, '')
        .trim()
    : firstLine;
  const body = lines.slice(1).join('\n').trim();
  return { shortSha, subject, firstLine, body };
}

/**
 * GitHub squash titles often end with `(#46)`.
 * @param {string} subject
 * @returns {number | null}
 */
export function extractPrNumberFromSubject(subject) {
  const m = subject.match(/\(#(\d+)\)\s*$/);
  if (m) return parseInt(m[1], 10);
  const m2 = subject.match(/\(#(\d+)\)/);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

/**
 * @param {string} url output of `git remote get-url origin`
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGithubRepoFromRemoteUrl(url) {
  if (!url?.trim()) return null;
  const u = url.trim();
  const scp = u.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (scp) return { owner: scp[1], repo: scp[2] };
  const https = u.match(
    /^https?:\/\/(?:[^@/]+\@)?github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/i,
  );
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

/**
 * @param {string} s `owner/repo`
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGithubRepoArg(s) {
  const m = String(s).trim().match(/^([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

/**
 * @param {string} cwd repo root (main app or submodule)
 * @returns {Promise<string | null>}
 */
async function getGitOriginUrl(cwd) {
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
 * @returns {Promise<{ ok: true, body: string } | { ok: false, error: string }>}
 */
export async function fetchGithubPullBodyViaGh(owner, repo, pullNumber) {
  const repoSpec = `${owner}/${repo}`;
  const args = [
    'pr',
    'view',
    String(pullNumber),
    '--repo',
    repoSpec,
    '--json',
    'body',
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
    const body =
      data.body === null || data.body === undefined ? '' : String(data.body);
    return { ok: true, body };
  } catch {
    return { ok: false, error: 'gh returned invalid JSON' };
  }
}

/**
 * @param {string[]} lines
 * @param {import('stream').Writable} write
 */
export function writeFormattedCommits(lines, write) {
  for (const commit of lines) {
    const split = commit.split('\n');
    write(`- ${split[0]}\n`);
    for (let i = 1; i < split.length; i++) {
      write(`  ${split[i]}\n`);
    }
  }
}

export async function getLastTag(projectRoot) {
  const r = await runGit(projectRoot, [
    'describe',
    '--tags',
    '--abbrev=0',
  ]);
  if (r.code !== 0) return null;
  const t = r.stdout.trim();
  return t || null;
}

export async function getCurrentCommitSha(projectRoot) {
  const r = await runGit(projectRoot, ['rev-parse', '--short', 'HEAD']);
  if (r.code !== 0) return 'HEAD';
  const s = r.stdout.trim();
  return s || 'HEAD';
}

/**
 * @param {string} projectRoot
 * @param {string} subPath
 * @param {string} tag
 */
export async function getSubmoduleShaAtTag(projectRoot, subPath, tag) {
  try {
    const spec = tag === 'HEAD' ? `HEAD:${subPath}` : `${tag}:${subPath}`;
    const r = await runGit(projectRoot, ['rev-parse', spec]);
    if (r.code !== 0) return null;
    const sha = r.stdout.trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} projectRoot
 * @param {string} subPath
 * @param {string} sha
 */
export async function getSubmoduleTagAtSha(projectRoot, subPath, sha) {
  try {
    const fullPath = path.join(projectRoot, subPath);
    if (!fs.existsSync(fullPath)) return null;
    const r = await runGit(projectRoot, [
      '-C',
      fullPath,
      'describe',
      '--tags',
      '--exact-match',
      sha,
    ]);
    if (r.code !== 0) return null;
    const t = r.stdout.trim();
    return t || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} projectRoot
 * @returns {Promise<string[]>}
 */
export async function getSubmodulePaths(projectRoot) {
  const gitmodulesPath = path.join(projectRoot, '.gitmodules');
  if (!fs.existsSync(gitmodulesPath)) return [];
  const content = fs.readFileSync(gitmodulesPath, 'utf8');
  const lines = content.split('\n');
  /** @type {string[]} */
  const paths = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('path = ')) {
      const p = trimmed.slice(7).trim();
      if (p) paths.push(p);
    }
  }
  return paths;
}

function shortSha(sha) {
  return sha.length >= 7 ? sha.slice(0, 7) : sha;
}

/**
 * @typedef {{ kind: 'updated', subPath: string, name: string, oldSha: string, newSha: string, fromDisplay: string, toDisplay: string, commits: string[] }
 *   | { kind: 'added', subPath: string, name: string, newSha: string, toDisplay: string }
 *   | { kind: 'removed', subPath: string, name: string, oldSha: string, fromDisplay: string }} SubmoduleDelta
 */

/**
 * @param {string} projectRoot
 * @param {string} subPath
 * @param {string} fromTag
 * @param {string} toTag
 * @param {(msg: string) => void} warn
 * @returns {Promise<SubmoduleDelta | null>}
 */
async function computeSubmoduleDelta(
  projectRoot,
  subPath,
  fromTag,
  toTag,
  warn,
) {
  const oldSha = await getSubmoduleShaAtTag(projectRoot, subPath, fromTag);
  const newSha = await getSubmoduleShaAtTag(projectRoot, subPath, toTag);

  if (oldSha && newSha && oldSha !== newSha) {
    const name = path.basename(subPath);
    const oldTag = await getSubmoduleTagAtSha(projectRoot, subPath, oldSha);
    const newTag = await getSubmoduleTagAtSha(projectRoot, subPath, newSha);
    const fromDisplay = oldTag ?? shortSha(oldSha);
    const toDisplay = newTag
      ? `${newTag} (${shortSha(newSha)})`
      : shortSha(newSha);

    const fullPath = path.join(projectRoot, subPath);
    const commits = await getFormattedLogCommits(
      projectRoot,
      oldSha,
      newSha,
      fullPath,
      {
        onGitError: ({ stderr }) => {
          if (stderr.trim()) warn(`git log submodule ${subPath}: ${stderr.trim()}`);
        },
      },
    );
    return {
      kind: 'updated',
      subPath,
      name,
      oldSha,
      newSha,
      fromDisplay,
      toDisplay,
      commits,
    };
  }
  if (!oldSha && newSha) {
    const name = path.basename(subPath);
    const newT =
      (await getSubmoduleTagAtSha(projectRoot, subPath, newSha)) ??
      shortSha(newSha);
    return {
      kind: 'added',
      subPath,
      name,
      newSha,
      toDisplay: newT,
    };
  }
  if (oldSha && !newSha) {
    const name = path.basename(subPath);
    const oldT =
      (await getSubmoduleTagAtSha(projectRoot, subPath, oldSha)) ??
      shortSha(oldSha);
    return {
      kind: 'removed',
      subPath,
      name,
      oldSha,
      fromDisplay: oldT,
    };
  }
  return null;
}

/**
 * @param {string} projectRoot
 * @param {string} fromTag
 * @param {string} toTag
 * @param {{ onGitWarning?: (msg: string) => void }} [opts]
 * @returns {Promise<SubmoduleDelta[]>}
 */
export async function getSubmoduleDeltas(projectRoot, fromTag, toTag, opts) {
  const warn = opts?.onGitWarning ?? (() => {});
  const subPaths = await getSubmodulePaths(projectRoot);
  const results = await Promise.all(
    subPaths.map((subPath) =>
      computeSubmoduleDelta(projectRoot, subPath, fromTag, toTag, warn),
    ),
  );
  return results.filter((d) => d != null);
}

/**
 * @param {string} projectRoot
 * @param {string} fromTag
 * @param {string} toTag
 * @param {{ onGitWarning?: (msg: string) => void }} [opts]
 */
export async function getSubmoduleChanges(projectRoot, fromTag, toTag, opts) {
  const lines = [];
  const deltas = await getSubmoduleDeltas(projectRoot, fromTag, toTag, opts);

  for (const d of deltas) {
    if (d.kind === 'updated') {
      lines.push(`### ${d.name}`, '', `**Path:** ${d.subPath}`);
      lines.push(`**From:** ${d.fromDisplay} **To:** ${d.toDisplay}`, '');
      if (d.commits.length > 0) {
        for (const c of d.commits) {
          const parts = c.split('\n');
          lines.push(`- ${parts[0]}`);
          for (let i = 1; i < parts.length; i++) lines.push(`  ${parts[i]}`);
        }
        lines.push('');
      } else {
        lines.push('(no changes)', '');
      }
    } else if (d.kind === 'added') {
      lines.push(
        `### ${d.name}`,
        '',
        `**Path:** ${d.subPath}`,
        `**From:** untagged **To:** ${d.toDisplay}`,
        '',
        '(submodule added)',
        '',
      );
    } else {
      lines.push(
        `### ${d.name}`,
        '',
        `**Path:** ${d.subPath}`,
        `**From:** ${d.fromDisplay} **To:** (removed)`,
        '',
        '(submodule removed)',
        '',
      );
    }
  }

  return lines.join('\n');
}

/**
 * @param {string} projectRoot
 * @param {string} toTag
 * @param {Date} now
 */
async function getReleaseVersionAndDate(projectRoot, toTag, now) {
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
async function resolveChangelogRevisionLabels(projectRoot, fromTag, toTag) {
  const fromDisplay =
    fromTag === 'HEAD'
      ? await getCurrentCommitSha(projectRoot)
      : fromTag;
  const toDisplay =
    toTag === 'HEAD' ? await getCurrentCommitSha(projectRoot) : toTag;
  return { fromDisplay, toDisplay };
}

/**
 * @param {string} projectRoot
 * @param {string} fromTag
 * @param {string} toTag
 */
async function loadMainRepositoryCommits(projectRoot, fromTag, toTag) {
  /** @type {string | null} */
  let mainLogErr = null;
  const mainCommits = await getFormattedLogCommits(
    projectRoot,
    fromTag,
    toTag,
    null,
    {
      onGitError: ({ stderr }) => {
        mainLogErr = stderr.trim() || 'git log failed';
      },
    },
  );
  return { mainCommits, mainLogErr };
}

/**
 * @typedef {{ fetchPr: boolean, repoOverride: { owner: string, repo: string } | null, cache: Map<string, Awaited<ReturnType<typeof fetchGithubPullBodyViaGh>>>, warn: (msg: string) => void }} GithubFetchContext
 */

/**
 * @param {string[]} commitBlocks
 * @param {string[]} out
 * @param {{ gitCwd: string, github?: GithubFetchContext | null }} [opts]
 */
async function appendTesterEntriesForCommitsAsync(commitBlocks, out, opts = {}) {
  const gh = opts.github;
  const gitCwd = opts.gitCwd;

  for (const block of commitBlocks) {
    const { shortSha, subject, body } = splitCommitBlock(block);
    let description = body.trim();

    if (!description && gh?.fetchPr) {
      const prNum = extractPrNumberFromSubject(subject);
      if (prNum != null) {
        const ownerRepo =
          gh.repoOverride ?? parseGithubRepoFromRemoteUrl(await getGitOriginUrl(gitCwd));
        if (!ownerRepo) {
          gh.warn(
            `Could not parse github.com from origin in ${gitCwd}; skipping PR #${prNum}`,
          );
        } else {
          const cacheKey = `${ownerRepo.owner}/${ownerRepo.repo}#${prNum}`;
          let fetched = gh.cache.get(cacheKey);
          if (!fetched) {
            fetched = await fetchGithubPullBodyViaGh(
              ownerRepo.owner,
              ownerRepo.repo,
              prNum,
            );
            gh.cache.set(cacheKey, fetched);
          }
          if (fetched.ok) {
            description = (fetched.body || '').trim();
          } else {
            gh.warn(
              `${ownerRepo.owner}/${ownerRepo.repo} PR #${prNum}: ${fetched.error}`,
            );
          }
        }
      }
    }

    const title = shortSha ? `${shortSha} — ${subject}` : subject;
    out.push(`#### ${title}`, '');
    if (description) {
      out.push(description, '');
    }
    out.push('');
  }
}

/**
 * Tester-facing changelog: full squash commit body, or full GitHub PR body when the commit body is empty and `(#N)` is in the subject.
 * @param {string} projectRoot
 * @param {string} fromTag
 * @param {string} toTag
 * @param {{ strictMainLog?: boolean, onGitWarning?: (msg: string) => void, fetchGithubPr?: boolean | null, githubRepo?: string | null }} [options]
 *   fetchGithubPr: false = never fetch (--no-fetch-github-pr); true / null / undefined = try `gh` when generating tester doc
 * @returns {Promise<{ markdown: string, warnings: string[] }>}
 */
export async function generateTesterChangelogMarkdown(
  projectRoot,
  fromTag,
  toTag,
  options = {},
) {
  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    options.onGitWarning?.(msg);
  };

  const flag = options.fetchGithubPr;
  const wantFetch = flag !== false;
  const repoOverrideParsed = options.githubRepo
    ? parseGithubRepoArg(options.githubRepo)
    : null;
  if (options.githubRepo && !repoOverrideParsed) {
    warn(
      `Invalid --github-repo "${options.githubRepo}" (expected owner/repo); ignoring override`,
    );
  }

  /** @type {GithubFetchContext | null} */
  let github = null;
  if (wantFetch) {
    const ghOk = await checkGhCliAuthenticated();
    if (!ghOk) {
      warn(
        'GitHub CLI is not logged in or not installed; PR descriptions will not be fetched. Run: gh auth login (install from https://cli.github.com/)',
      );
    } else {
      github = {
        fetchPr: true,
        repoOverride: repoOverrideParsed,
        cache: new Map(),
        warn,
      };
    }
  }

  const now = new Date();
  const { version, dateString } = await getReleaseVersionAndDate(
    projectRoot,
    toTag,
    now,
  );

  const { fromDisplay, toDisplay } = await resolveChangelogRevisionLabels(
    projectRoot,
    fromTag,
    toTag,
  );

  /** @type {string[]} */
  const out = [];
  out.push(
    '# Tester changelog',
    '',
    `## Release ${version}`,
    `**Date:** ${dateString}`,
    `**From:** ${fromDisplay} **To:** ${toDisplay}`,
    '',
  );
  out.push('');

  const { mainCommits, mainLogErr } = await loadMainRepositoryCommits(
    projectRoot,
    fromTag,
    toTag,
  );

  out.push('## Main app', '');

  if (mainLogErr) {
    const msg = `Main repository git log failed (${fromTag}..${toTag}): ${mainLogErr}`;
    warn(msg);
    if (options.strictMainLog) {
      throw new Error(msg);
    }
    out.push('*(Could not list commits.)*', '');
  } else if (mainCommits.length > 0) {
    await appendTesterEntriesForCommitsAsync(mainCommits, out, {
      gitCwd: projectRoot,
      github,
    });
  } else {
    out.push('*(no changes)*', '');
  }

  const deltas = await getSubmoduleDeltas(projectRoot, fromTag, toTag, {
    onGitWarning: warn,
  });

  if (deltas.length > 0) {
    out.push('## Submodules', '');
    for (const d of deltas) {
      if (d.kind === 'updated') {
        out.push(
          `### ${d.name}`,
          '',
          `**Path:** ${d.subPath}`,
          `**From:** ${d.fromDisplay} **To:** ${d.toDisplay}`,
          '',
        );
        if (d.commits.length > 0) {
          await appendTesterEntriesForCommitsAsync(d.commits, out, {
            gitCwd: path.join(projectRoot, d.subPath),
            github,
          });
        } else {
          out.push('*(no commit list)*', '');
        }
      } else if (d.kind === 'added') {
        out.push(
          `### ${d.name} (added)`,
          '',
          `**Path:** ${d.subPath}`,
          `**Now at:** ${d.toDisplay}`,
          '',
          'Submodule was added; confirm checkout and app behavior for anything that depends on it.',
          '',
        );
      } else {
        out.push(
          `### ${d.name} (removed)`,
          '',
          `**Path:** ${d.subPath}`,
          `**Was at:** ${d.fromDisplay}`,
          '',
          'Submodule was removed; regression-test any flows that used it.',
          '',
        );
      }
    }
  }

  const scriptFile = fileURLToPath(import.meta.url);
  out.push(
    '---',
    `*Generated on ${now.toISOString()} by ${path.basename(scriptFile)} (tester view)*`,
  );

  return { markdown: out.join('\n'), warnings };
}

/**
 * @param {string} projectRoot
 * @param {string} fromTag
 * @param {string} toTag
 * @param {{ strictMainLog?: boolean, onGitWarning?: (msg: string) => void }} [options]
 * @returns {Promise<{ markdown: string, warnings: string[] }>}
 */
export async function generateChangelogMarkdown(
  projectRoot,
  fromTag,
  toTag,
  options = {},
) {
  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    options.onGitWarning?.(msg);
  };

  const now = new Date();
  const { version, dateString } = await getReleaseVersionAndDate(
    projectRoot,
    toTag,
    now,
  );

  /** @type {string[]} */
  const out = [];
  out.push('# Changelog', '', `## Release ${version}`, `**Date:** ${dateString}`, '');

  out.push('## Main Repository', '');

  const { fromDisplay, toDisplay } = await resolveChangelogRevisionLabels(
    projectRoot,
    fromTag,
    toTag,
  );

  out.push(`**From:** ${fromDisplay} **To:** ${toDisplay}`, '');

  const { mainCommits, mainLogErr } = await loadMainRepositoryCommits(
    projectRoot,
    fromTag,
    toTag,
  );

  if (mainLogErr) {
    const msg = `Main repository git log failed (${fromTag}..${toTag}): ${mainLogErr}`;
    warn(msg);
    if (options.strictMainLog) {
      throw new Error(msg);
    }
    out.push('*(could not list commits — see stderr / warnings)*', '');
  } else if (mainCommits.length > 0) {
    for (const c of mainCommits) {
      const parts = c.split('\n');
      out.push(`- ${parts[0]}`);
      for (let i = 1; i < parts.length; i++) out.push(`  ${parts[i]}`);
    }
    out.push('');
  } else {
    out.push('(no changes)', '');
  }

  const submoduleBlock = await getSubmoduleChanges(
    projectRoot,
    fromTag,
    toTag,
    { onGitWarning: warn },
  );
  if (submoduleBlock.trim()) {
    out.push('## Submodules', '', submoduleBlock);
  }

  const scriptFile = fileURLToPath(import.meta.url);
  out.push('', '---', `*Generated on ${now.toISOString()} by ${path.basename(scriptFile)}*`);

  return { markdown: out.join('\n'), warnings };
}

/**
 * @param {string} question
 * @returns {Promise<string>}
 */
function promptLine(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer ?? '');
    });
  });
}

function parseCliArgs(argv) {
  const out = {
    help: false,
    projectRoot: null,
    gitRoot: null,
    output: null,
    testerOutput: null,
    noTester: false,
    /** @type {boolean | null} null = default (use gh when authenticated) */
    fetchGithubPr: null,
    githubRepo: null,
    from: null,
    to: null,
    strict: false,
    positionals: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      out.help = true;
    } else if (
      a === '--project-root' ||
      a === '--git-root' ||
      a === '--output' ||
      a === '-o' ||
      a === '--tester-output' ||
      a === '--from' ||
      a === '--to' ||
      a === '--github-repo'
    ) {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`Error: ${a} requires a value`);
        process.exitCode = 1;
        out.help = true;
        break;
      }
      if (a === '--project-root') out.projectRoot = v;
      else if (a === '--git-root') out.gitRoot = v;
      else if (a === '--output' || a === '-o') out.output = v;
      else if (a === '--tester-output') out.testerOutput = v;
      else if (a === '--from') out.from = v;
      else if (a === '--to') out.to = v;
      else if (a === '--github-repo') out.githubRepo = v;
    } else if (a === '--no-tester') {
      out.noTester = true;
    } else if (a === '--fetch-github-pr') {
      out.fetchGithubPr = true;
    } else if (a === '--no-fetch-github-pr') {
      out.fetchGithubPr = false;
    } else if (a === '--strict') {
      out.strict = true;
    } else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exitCode = 1;
      out.help = true;
      break;
    } else {
      out.positionals.push(a);
    }
  }
  if (!out.from && out.positionals[0]) out.from = out.positionals[0];
  if (!out.to && out.positionals[1]) out.to = out.positionals[1];
  return out;
}

function usage() {
  console.log(`Usage: generate-changelog.mjs [options] [fromRev] [toRev]

Writes changelog.md (full git log) and changelog_tester.md (full squash/PR description per commit).

Options:
  --from <rev>           Start revision (tag, branch, SHA, or HEAD)
  --to <rev>             End revision (default: HEAD when omitted in prompts)
  --output, -o <path>    Engineering changelog path (default: changelog.md)
  --tester-output <path> Tester changelog path (default: changelog_tester.md)
  --no-tester            Skip changelog_tester.md
  --project-root <dir>   Flutter app root (default: discover pubspec.yaml)
  --git-root <dir>       Git repo root (no pubspec required; overrides discovery)
  --fetch-github-pr      Optional; PR fetch via gh is already the default when gh is logged in
  --no-fetch-github-pr   Never fetch PR bodies from GitHub
  --github-repo org/repo github.com owner/repo for the main app (if origin is not github.com)
  --strict               Exit with error if main repo git log fails
  -h, --help             Show this help

  PR fetch uses GitHub CLI only (gh pr view). If gh auth login was not run, a warning is printed and PRs are skipped.
  Submodules use that submodule's origin URL (github.com, or GH_HOST for Enterprise with gh).

Interactive (TTY): prompts for missing from/to (defaults: last tag → HEAD).
Non-interactive: missing from defaults to latest tag or HEAD; missing to defaults to HEAD.

Examples:
  node node/lib/generate-changelog.mjs v1.0.0 HEAD
  node node/lib/generate-changelog.mjs --from v1.0.0 --output release-notes.md
  node node/lib/generate-changelog.mjs --no-fetch-github-pr v1.0.0 HEAD
`);
}

/**
 * @param {string} projectRoot
 * @param {string | null} outputPath
 * @param {string} defaultRelative
 */
function resolveOutputPath(projectRoot, outputPath, defaultRelative) {
  if (outputPath) {
    return path.isAbsolute(outputPath)
      ? outputPath
      : path.join(projectRoot, outputPath);
  }
  return path.join(projectRoot, defaultRelative);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseCliArgs(argv);
  if (args.help) {
    usage();
    process.exit(process.exitCode || 0);
  }

  const thisFile = fileURLToPath(import.meta.url);
  let projectRoot = null;
  if (args.gitRoot) {
    projectRoot = path.resolve(args.gitRoot);
  } else {
    projectRoot =
      args.projectRoot ??
      resolveFlutterProjectRoot({
        startDir: process.cwd(),
        scriptFile: thisFile,
      });
  }

  if (!projectRoot) {
    console.error(
      'Error: could not find pubspec.yaml (use --project-root, --git-root, or run from a Flutter project).',
    );
    process.exit(1);
  }

  /** @type {{ code: number, stdout: string, stderr: string }} */
  let inGit;
  try {
    inGit = await runGit(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  } catch (e) {
    console.error(
      'Error: could not run git (is it on PATH?):',
      String(e?.message ?? e),
    );
    process.exit(1);
  }
  if (inGit.code !== 0) {
    const detail =
      inGit.stderr.trim() || inGit.stdout.trim() || 'git rev-parse failed';
    console.error(`Error: git failed while checking repository: ${detail}`);
    process.exit(1);
  }
  if (inGit.stdout.trim() !== 'true') {
    console.error('Error: not a git repository:', projectRoot);
    process.exit(1);
  }

  let fromTag = args.from?.trim() || null;
  let toTag = args.to?.trim() || null;
  const interactive = process.stdin.isTTY && process.stdout.isTTY;

  if (!fromTag) {
    if (interactive) {
      const lastTag = await getLastTag(projectRoot);
      if (lastTag) {
        console.log(`Last tag: ${lastTag}`);
        const input = (
          await promptLine(
            `Enter FROM revision (Enter = ${lastTag}): `,
          )
        ).trim();
        fromTag = input || lastTag;
      } else {
        const input = (
          await promptLine('Enter FROM revision (Enter = HEAD): ')
        ).trim();
        fromTag = input || 'HEAD';
      }
    } else {
      fromTag = (await getLastTag(projectRoot)) ?? 'HEAD';
    }
  }

  if (!toTag) {
    if (interactive) {
      const input = (
        await promptLine('Enter TO revision (Enter = HEAD): ')
      ).trim();
      toTag = input || 'HEAD';
    } else {
      toTag = 'HEAD';
    }
  }

  const finalFrom = fromTag;
  const finalTo = toTag;

  console.log(`Generating changelog: ${finalFrom} .. ${finalTo}`);

  const genOpts = { strictMainLog: args.strict };

  let result;
  try {
    result = await generateChangelogMarkdown(
      projectRoot,
      finalFrom,
      finalTo,
      genOpts,
    );
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }

  for (const w of result.warnings) {
    console.warn(`Warning: ${w}`);
  }

  const outPath = resolveOutputPath(projectRoot, args.output, 'changelog.md');
  fs.writeFileSync(outPath, result.markdown, 'utf8');
  console.log(`Wrote ${outPath}`);

  if (!args.noTester) {
    let testerResult;
    try {
      testerResult = await generateTesterChangelogMarkdown(
        projectRoot,
        finalFrom,
        finalTo,
        {
          ...genOpts,
          fetchGithubPr:
            args.fetchGithubPr === null ? undefined : args.fetchGithubPr,
          githubRepo: args.githubRepo,
        },
      );
    } catch (e) {
      console.error(String(e?.message ?? e));
      process.exit(1);
    }
    const seenWarnings = new Set(result.warnings);
    for (const w of testerResult.warnings) {
      if (!seenWarnings.has(w)) {
        console.warn(`Warning: ${w}`);
        seenWarnings.add(w);
      }
    }
    const testerPath = resolveOutputPath(
      projectRoot,
      args.testerOutput,
      'changelog_tester.md',
    );
    fs.writeFileSync(testerPath, testerResult.markdown, 'utf8');
    console.log(`Wrote ${testerPath}`);
  }
}

const entry = process.argv[1];
if (entry) {
  try {
    if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(entry)) {
      main().catch((e) => {
        console.error(e);
        process.exit(1);
      });
    }
  } catch {
    // ignore
  }
}
