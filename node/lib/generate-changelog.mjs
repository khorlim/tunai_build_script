#!/usr/bin/env node
/**
 * Generate changelog.md (engineering) and changelog_tester.md from git history.
 * Engineering log: full commit list. Tester doc: **PRs only** — grouped under **Main app** and each
 * **Submodule**; each entry is GitHub **PR title + description** (from `gh pr view` when available).
 * Only commits whose subject contains `(#N)` are included. Requires git on PATH; PR fetch uses **GitHub CLI** with **parallel prefetch** (default 8 concurrent `gh pr view` calls).
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
import { fileURLToPath } from 'url';
import {
  runGit,
  parseFormattedLogOutput,
  getFormattedLogCommits,
  getLastTag,
  getCurrentCommitSha,
  getSubmoduleShaAtTag,
  getSubmoduleTagAtSha,
  getSubmodulePaths,
  getSubmoduleDeltas,
  getSubmoduleChanges,
} from './changelog/changelog-git.mjs';

import {
  extractPrTesterSections,
  splitCommitBlock,
  extractPrNumberFromSubject,
  stripPrMarkerFromSubject,
  parseGithubRepoFromRemoteUrl,
  parseGithubRepoArg,
} from './changelog/changelog-parse.mjs';

import {
  getGitOriginUrl,
  checkGhCliAuthenticated,
  fetchGithubPullViaGh,
  fetchGithubPullBodyViaGh,
} from './changelog/changelog-github.mjs';

import {
  getReleaseVersionAndDate,
  resolveChangelogRevisionLabels,
} from './changelog/changelog-release.mjs';

import {
  appendTesterPrOnlyEntriesAsync,
  prefetchTesterPullMetadata,
} from './changelog/changelog-tester-pr.mjs';

export {
  parseFormattedLogOutput,
  getFormattedLogCommits,
  getLastTag,
  getCurrentCommitSha,
  getSubmoduleShaAtTag,
  getSubmoduleTagAtSha,
  getSubmodulePaths,
  getSubmoduleDeltas,
  getSubmoduleChanges,
} from './changelog/changelog-git.mjs';

export {
  extractPrTesterSections,
  splitCommitBlock,
  extractPrNumberFromSubject,
  stripPrMarkerFromSubject,
  demoteMarkdownHeadings,
  parseGithubRepoFromRemoteUrl,
  parseGithubRepoArg,
} from './changelog/changelog-parse.mjs';

export {
  checkGhCliAuthenticated,
  fetchGithubPullBodyViaGh,
  fetchGithubPullViaGh,
  getGitOriginUrl,
  prefetchGithubPullJobs,
  runPool,
  DEFAULT_GH_PR_FETCH_CONCURRENCY,
} from './changelog/changelog-github.mjs';

export { getReleaseVersionAndDate, resolveChangelogRevisionLabels } from './changelog/changelog-release.mjs';

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
 * Tester-facing changelog: PR title + description per `(#N)` in squash subject, grouped by main app vs submodule.
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

  /** @type {{ fetchPr: boolean, repoOverride: { owner: string, repo: string } | null, cache: Map<string, Awaited<ReturnType<typeof fetchGithubPullViaGh>>>, warn: (msg: string) => void } | null} */
  let github = null;
  if (wantFetch) {
    const ghOk = await checkGhCliAuthenticated();
    if (!ghOk) {
      warn(
        'GitHub CLI is not logged in or not installed; PR titles/descriptions use commit text only. Run: gh auth login (install from https://cli.github.com/)',
      );
    } else {
      github = {
        fetchPr: true,
        repoOverride: repoOverrideParsed,
        cache: new Map(),
        originUrlCache: new Map(),
        warn,
      };
    }
  }

  const now = new Date();
  const [{ version, dateString }, { fromDisplay, toDisplay }, { mainCommits, mainLogErr }, deltas] =
    await Promise.all([
      getReleaseVersionAndDate(projectRoot, toTag, now),
      resolveChangelogRevisionLabels(projectRoot, fromTag, toTag),
      loadMainRepositoryCommits(projectRoot, fromTag, toTag),
      getSubmoduleDeltas(projectRoot, fromTag, toTag, {
        onGitWarning: warn,
      }),
    ]);

  if (github?.fetchPr) {
    await prefetchTesterPullMetadata(
      github,
      projectRoot,
      mainCommits,
      deltas,
    );
  }

  /** @type {string[]} */
  const out = [];
  out.push(
    '# Tester changelog (PRs)',
    '',
    `## Release ${version}`,
    '',
    `- **Date:** ${dateString}`,
    `- **From:** \`${fromDisplay}\` → **To:** \`${toDisplay}\``,
    '',
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
    out.push('### Merged PRs', '');
    await appendTesterPrOnlyEntriesAsync(mainCommits, out, {
      gitCwd: projectRoot,
      github,
      projectRootForGithubOverride: projectRoot,
    });
  } else {
    out.push('*(no changes)*', '');
  }

  if (deltas.length > 0) {
    out.push('## Submodules', '');
    for (const d of deltas) {
      if (d.kind === 'updated') {
        out.push(
          `### ${d.name}`,
          '',
          `> **Path:** \`${d.subPath}\` · **${d.fromDisplay}** → **${d.toDisplay}**`,
          '',
        );
        if (d.commits.length > 0) {
          await appendTesterPrOnlyEntriesAsync(d.commits, out, {
            gitCwd: path.join(projectRoot, d.subPath),
            github,
            projectRootForGithubOverride: projectRoot,
          });
        } else {
          out.push('*(no commit list)*', '');
        }
      } else if (d.kind === 'added') {
        out.push(
          `### ${d.name} (added)`,
          '',
          `> **Path:** \`${d.subPath}\` · **Now at:** **${d.toDisplay}**`,
          '',
          '> Submodule was added; confirm checkout and app behavior for anything that depends on it.',
          '',
        );
      } else {
        out.push(
          `### ${d.name} (removed)`,
          '',
          `> **Path:** \`${d.subPath}\` · **Was at:** **${d.fromDisplay}**`,
          '',
          '> Submodule was removed; regression-test any flows that used it.',
          '',
        );
      }
    }
  }

  const scriptFile = fileURLToPath(import.meta.url);
  out.push(
    '---',
    `*Generated on ${now.toISOString()} by ${path.basename(scriptFile)} (tester PR view)*`,
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

Writes changelog.md (full git log) and changelog_tester.md (PR title + description per PR, grouped by main app and submodules).

Options:
  --from <rev>           Start revision (tag, branch, SHA, or HEAD)
  --to <rev>             End revision (default: HEAD when omitted in prompts)
  --output, -o <path>    Engineering changelog path (default: changelog.md)
  --tester-output <path> Tester changelog path (default: changelog_tester.md)
  --no-tester            Skip changelog_tester.md
  --project-root <dir>   Flutter app root (default: discover pubspec.yaml)
  --git-root <dir>       Git repo root (no pubspec required; overrides discovery)
  --fetch-github-pr      Optional; PR fetch via gh is already the default when gh is logged in
  --no-fetch-github-pr   Never fetch PR titles/bodies from GitHub (use commit subject/body only)
  --github-repo org/repo github.com owner/repo for the main app (if origin is not github.com)
  --strict               Exit with error if main repo git log fails
  -h, --help             Show this help

  Tester doc includes only commits whose subject contains (#N). Submodules use that submodule's origin URL.
  PR metadata uses GitHub CLI (gh pr view). If gh auth login was not run, commit text is used as fallback.

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
