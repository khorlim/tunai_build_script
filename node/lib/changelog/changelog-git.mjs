import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

/** Record/field delimiters for `git log --format`. Do not use \\x01/\\x02 in subjects or bodies or parsing will split incorrectly. */
export const RECORD_START = '\x01';
export const FIELD_SEP = '\x02';

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runGit(cwd, args) {
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
export function runProcess(cwd, command, args) {
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

/**
 * @param {string} projectRoot
 * @param {string} prefix
 */
export async function getLastTagMatchingPrefix(projectRoot, prefix) {
  const trimmed = prefix?.trim() ?? '';
  if (!trimmed) return getLastTag(projectRoot);

  const r = await runGit(projectRoot, [
    'describe',
    '--tags',
    '--abbrev=0',
    '--match',
    `${trimmed}-v*`,
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
