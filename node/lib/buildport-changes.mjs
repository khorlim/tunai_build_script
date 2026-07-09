import fs from 'fs';
import path from 'path';
import { parseGithubRepoFromRemoteUrl } from './changelog/changelog-parse.mjs';
import { getGitOriginUrl } from './changelog/changelog-github.mjs';

export const DEFAULT_TESTER_CHANGELOG = 'changelog_tester.md';
const MAX_CHANGES = 100;

const PR_HEADING_RE = /^#{3,5}\s+PR\s+#(\d+)\s+[—–-]\s+(.+?)\s*$/;
const SUBMODULE_HEADING_RE = /^###\s+(?!PR\s+#)(\S.*?)\s*$/;
const PATH_LINE_RE = /^\*\*Path:\*\*\s+(\S+)\s*$/;

/**
 * Parse a tester changelog (written by --generate-changelog / --prepare-release)
 * into one entry per PR heading. Only the first `## Release` section is read so
 * stale entries from an appended file never leak into a new upload.
 *
 * @param {string} content
 * @returns {{ prNumber: string, title: string, submodule: string | null, subPath: string | null }[]}
 */
export function parseTesterChangelog(content) {
  const lines = String(content ?? '').split(/\r?\n/);
  const entries = [];
  let releaseSections = 0;
  let inSubmodules = false;
  let submodule = null;
  let subPath = null;

  // A submodule section heading is a `###` heading followed by a `**Path:**`
  // line before the next heading. PR body headings (`### Changes`,
  // `### Risk Level`, ...) have no Path line, so they never match.
  const submodulePathAfter = (index) => {
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (/^#{2,6}\s/.test(line)) return null;
      const p = line.match(PATH_LINE_RE);
      if (p) return p[1];
    }
    return null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+Release\b/.test(line)) {
      releaseSections += 1;
      if (releaseSections > 1) break;
      continue;
    }
    if (/^##\s+Submodules\s*$/.test(line)) {
      inSubmodules = true;
      submodule = null;
      subPath = null;
      continue;
    }
    if (/^##\s+Main app\s*$/.test(line)) {
      inSubmodules = false;
      submodule = null;
      subPath = null;
      continue;
    }

    const pr = line.match(PR_HEADING_RE);
    if (pr) {
      entries.push({
        prNumber: pr[1],
        title: pr[2],
        submodule: inSubmodules ? submodule : null,
        subPath: inSubmodules ? subPath : null,
      });
      continue;
    }

    if (inSubmodules) {
      const sub = line.match(SUBMODULE_HEADING_RE);
      if (sub) {
        const foundPath = submodulePathAfter(index);
        if (foundPath) {
          submodule = sub[1];
          subPath = foundPath;
        }
      }
    }
  }

  return entries;
}

/**
 * Buildport category from a PR title. Heuristic over common branch/commit
 * prefixes; anything unrecognised counts as an improvement.
 *
 * @param {string} title
 * @returns {'feature' | 'fix' | 'improvement' | 'internal'}
 */
export function categorizeChangeTitle(title) {
  const t = String(title ?? '').toLowerCase();
  if (/(^|[\s/:_-])(fix|bugfix|hotfix)([\s/:_-]|$)/.test(t)) return 'fix';
  if (/(^|[\s/:_-])(feat|feature)([\s/:_-]|$)/.test(t)) return 'feature';
  if (/(^|[\s/:_-])(refactor|chore|cleanup|deps|docs|ci|test|tests)([\s/:_-]|$)/.test(t)) {
    return 'internal';
  }
  return 'improvement';
}

/**
 * Build the Buildport `changes` payload from the tester changelog, resolving
 * PR URLs from each repo's github.com origin (main repo or submodule path).
 * Returns [] when the changelog file is missing or has no PR entries.
 *
 * @param {object} params
 * @param {string} params.projectRoot
 * @param {string} [params.changesPath] project-relative or absolute tester changelog path
 * @param {(msg: string) => void} [params.warn]
 * @returns {Promise<{ text: string, pr_number: string, pr_url?: string, module?: string, category: string }[]>}
 */
export async function collectBuildportChanges({
  projectRoot,
  changesPath,
  warn = () => {},
}) {
  const rel = changesPath || DEFAULT_TESTER_CHANGELOG;
  const file = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
  if (!fs.existsSync(file)) {
    if (changesPath) {
      warn(`Buildport changes: changelog file not found: ${file}`);
    }
    return [];
  }

  let entries;
  try {
    entries = parseTesterChangelog(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    warn(`Buildport changes: could not read ${file}: ${String(e?.message ?? e)}`);
    return [];
  }
  if (!entries.length) return [];

  const originMemo = new Map();
  const repoByCwd = new Map();
  const resolveRepo = async (gitCwd) => {
    const key = path.resolve(gitCwd);
    if (!repoByCwd.has(key)) {
      let repo = null;
      try {
        repo = parseGithubRepoFromRemoteUrl(
          await getGitOriginUrl(gitCwd, originMemo),
        );
      } catch {
        repo = null;
      }
      repoByCwd.set(key, repo);
    }
    return repoByCwd.get(key);
  };

  const changes = [];
  for (const entry of entries.slice(0, MAX_CHANGES)) {
    const gitCwd = entry.subPath
      ? path.join(projectRoot, entry.subPath)
      : projectRoot;
    const repo = fs.existsSync(gitCwd) ? await resolveRepo(gitCwd) : null;
    const change = {
      text: entry.title,
      pr_number: entry.prNumber,
      category: categorizeChangeTitle(entry.title),
    };
    if (entry.submodule) {
      change.module = entry.submodule;
    }
    if (repo) {
      change.pr_url = `https://github.com/${repo.owner}/${repo.repo}/pull/${entry.prNumber}`;
    }
    changes.push(change);
  }
  return changes;
}
