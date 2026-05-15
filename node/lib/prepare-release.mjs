import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { bumpVersion } from './bump.mjs';
import {
  generateChangelogMarkdown,
  generateTesterChangelogMarkdown,
} from './generate-changelog.mjs';
import { runGit, getLastTag } from './changelog/changelog-git.mjs';
import { getVersion } from './pubspec.mjs';

const ENGINEERING_CHANGELOG = 'changelog.md';
const TESTER_CHANGELOG = 'changelog_tester.md';

/**
 * @param {string} projectRoot
 * @returns {string[]}
 */
function collectTrackedRelativePaths(projectRoot) {
  const rels = ['pubspec.yaml', ENGINEERING_CHANGELOG, TESTER_CHANGELOG];
  const optional = [
    'ios/Runner/Info.plist',
    'macos/Runner/Info.plist',
    'android/app/build.gradle',
    'android/app/build.gradle.kts',
  ];
  for (const rel of optional) {
    if (fs.existsSync(path.join(projectRoot, rel))) rels.push(rel);
  }
  return rels;
}

/**
 * @param {string} projectRoot
 * @param {string[]} relativePaths
 * @returns {Map<string, string | null>}
 */
function snapshotFiles(projectRoot, relativePaths) {
  /** @type {Map<string, string | null>} */
  const map = new Map();
  for (const rel of relativePaths) {
    const full = path.join(projectRoot, rel);
    map.set(rel, fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null);
  }
  return map;
}

/**
 * @param {string} projectRoot
 * @param {Map<string, string | null>} snapshots
 */
function restoreSnapshots(projectRoot, snapshots) {
  for (const [rel, content] of snapshots) {
    const full = path.join(projectRoot, rel);
    if (content === null) {
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
  }
}

/**
 * @param {string} prefix
 * @param {string} pubspecVersion
 */
export function buildReleaseTagName(prefix, pubspecVersion) {
  const core = `v${pubspecVersion}`;
  const trimmed = prefix?.trim() ?? '';
  if (!trimmed) return core;
  return `${trimmed}-${core}`;
}

/**
 * @param {string} tag
 */
function assertValidGitTag(tag) {
  if (!tag || /\s/.test(tag) || tag.includes('..') || tag.endsWith('.lock')) {
    throw new Error(`Invalid git tag name: "${tag}"`);
  }
}

/**
 * @param {string} question
 * @param {string} [defaultValue]
 */
async function promptLine(question, defaultValue = '') {
  if (!input.isTTY) return defaultValue;
  const rl = readline.createInterface({ input, output });
  try {
    const suffix = defaultValue ? ` (Enter = ${defaultValue})` : '';
    const ans = (await rl.question(`${question}${suffix}: `)).trim();
    return ans || defaultValue;
  } finally {
    rl.close();
  }
}

/**
 * @param {string} projectRoot
 */
async function assertGitRepo(projectRoot) {
  const r = await runGit(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  if (r.code !== 0 || r.stdout.trim() !== 'true') {
    throw new Error(`Not a git repository: ${projectRoot}`);
  }
}

/**
 * @param {string} projectRoot
 */
async function assertCleanWorkingTree(projectRoot) {
  const r = await runGit(projectRoot, ['status', '--porcelain']);
  if (r.code !== 0) {
    throw new Error(r.stderr.trim() || 'git status failed');
  }
  if (r.stdout.trim()) {
    throw new Error(
      'Working tree must be clean before --prepare-release (commit or stash changes first).',
    );
  }
}

/**
 * @param {string} projectRoot
 */
async function resolveInitialHead(projectRoot) {
  const r = await runGit(projectRoot, ['rev-parse', 'HEAD']);
  if (r.code !== 0 || !r.stdout.trim()) {
    throw new Error('Could not resolve HEAD');
  }
  return r.stdout.trim();
}

/**
 * @param {{
 *   interactive: boolean,
 *   changelogFrom: string | null,
 *   changelogTo: string | null,
 *   tagPrefix: string | null,
 *   projectRoot: string,
 * }} opts
 */
async function resolveChangelogAndTagOptions(opts) {
  const { interactive, projectRoot } = opts;
  let changelogFrom = opts.changelogFrom?.trim() || null;
  let changelogTo = opts.changelogTo?.trim() || null;
  /** @type {string | null} null = prompt; undefined = use empty prefix */
  let tagPrefix = opts.tagPrefix;

  if (!interactive) {
    if (!changelogFrom) {
      throw new Error(
        'Non-interactive mode requires --changelog-from <rev> (e.g. last release tag).',
      );
    }
    if (tagPrefix === null) {
      throw new Error(
        'Non-interactive mode requires --tag-prefix <prefix> (use empty string for v1.0.0+1 style only).',
      );
    }
    changelogTo = changelogTo || 'HEAD';
    return { changelogFrom, changelogTo, tagPrefix: tagPrefix ?? '' };
  }

  const lastTag = await getLastTag(projectRoot);
  if (!changelogFrom) {
    if (lastTag) {
      console.log(`Last tag: ${lastTag}`);
      changelogFrom = await promptLine('Changelog FROM revision', lastTag);
    } else {
      changelogFrom = await promptLine('Changelog FROM revision', 'HEAD');
    }
  }
  if (!changelogTo) {
    changelogTo = await promptLine('Changelog TO revision', 'HEAD');
  }
  if (tagPrefix === null) {
    tagPrefix = await promptLine(
      'Git tag prefix (empty = v{version} only, e.g. release → release-v{version})',
      '',
    );
  }

  return {
    changelogFrom,
    changelogTo,
    tagPrefix: tagPrefix ?? '',
  };
}

/**
 * @param {string} projectRoot
 * @param {string} fromRev
 * @param {string} toRev
 */
async function writeChangelogs(projectRoot, fromRev, toRev) {
  console.log(`Generating changelog: ${fromRev} .. ${toRev}`);

  const eng = await generateChangelogMarkdown(projectRoot, fromRev, toRev);
  for (const w of eng.warnings) console.warn(`Warning: ${w}`);

  const engPath = path.join(projectRoot, ENGINEERING_CHANGELOG);
  fs.writeFileSync(engPath, eng.markdown, 'utf8');
  console.log(`Wrote ${engPath}`);

  const tester = await generateTesterChangelogMarkdown(
    projectRoot,
    fromRev,
    toRev,
  );
  const seen = new Set(eng.warnings);
  for (const w of tester.warnings) {
    if (!seen.has(w)) console.warn(`Warning: ${w}`);
  }

  const testerPath = path.join(projectRoot, TESTER_CHANGELOG);
  fs.writeFileSync(testerPath, tester.markdown, 'utf8');
  console.log(`Wrote ${testerPath}`);
}

/**
 * @param {string} projectRoot
 * @param {string[]} relativePaths
 * @param {string} message
 */
async function gitCommit(projectRoot, relativePaths, message) {
  const add = await runGit(projectRoot, ['add', '--', ...relativePaths]);
  if (add.code !== 0) {
    throw new Error(add.stderr.trim() || 'git add failed');
  }
  const commit = await runGit(projectRoot, ['commit', '-m', message]);
  if (commit.code !== 0) {
    throw new Error(commit.stderr.trim() || 'git commit failed');
  }
}

/**
 * @param {{
 *   projectRoot: string,
 *   bumpType: string,
 *   manualVersion?: string | null,
 *   changelogFrom?: string | null,
 *   changelogTo?: string | null,
 *   tagPrefix?: string | null,
 * }} opts
 */
export async function runPrepareRelease(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const interactive = input.isTTY && output.isTTY;

  await assertGitRepo(projectRoot);
  await assertCleanWorkingTree(projectRoot);

  const trackedPaths = collectTrackedRelativePaths(projectRoot);
  const snapshots = snapshotFiles(projectRoot, trackedPaths);
  const initialHead = await resolveInitialHead(projectRoot);

  /** @type {{ committed: boolean, pushed: boolean, tagCreated: boolean, tagName: string | null }} */
  const gitState = {
    committed: false,
    pushed: false,
    tagCreated: false,
    tagName: null,
  };

  const rollback = async (reason) => {
    console.error(`\nPrepare release failed: ${reason}`);
    console.error('Rolling back…');

    if (gitState.tagCreated && gitState.tagName) {
      await runGit(projectRoot, ['tag', '-d', gitState.tagName]);
    }
    if (gitState.committed) {
      const reset = await runGit(projectRoot, ['reset', '--hard', initialHead]);
      if (reset.code !== 0) {
        console.error(
          `Warning: git reset --hard failed: ${reset.stderr.trim() || reset.stdout.trim()}`,
        );
      }
    }

    restoreSnapshots(projectRoot, snapshots);

    if (gitState.pushed) {
      console.error(
        'Warning: changes may already exist on the remote. You may need to revert the commit and delete the remote tag manually.',
      );
    }
    throw new Error(reason);
  };

  try {
    const { changelogFrom, changelogTo, tagPrefix } =
      await resolveChangelogAndTagOptions({
        interactive,
        projectRoot,
        changelogFrom: opts.changelogFrom ?? null,
        changelogTo: opts.changelogTo ?? null,
        tagPrefix: opts.tagPrefix ?? null,
      });

    console.log(`\n[1/6] Bumping version (${opts.bumpType})…`);
    const bumpResult = await bumpVersion({
      projectRoot,
      bumpType: opts.bumpType,
      manualVersion: opts.manualVersion ?? undefined,
      yes: true,
      noBumpBuild: false,
    });

    const version =
      bumpResult?.newVersion ?? getVersion(projectRoot);
    if (!version) {
      throw new Error('Could not read version from pubspec.yaml after bump');
    }

    console.log('\n[2/6] Generating changelogs…');
    await writeChangelogs(projectRoot, changelogFrom, changelogTo);

    const releasePaths = collectTrackedRelativePaths(projectRoot);
    const commitMessage = `chore(release): v${version}`;

    console.log('\n[3/6] Committing…');
    await gitCommit(projectRoot, releasePaths, commitMessage);
    gitState.committed = true;

    console.log('\n[4/6] Pushing commit…');
    const push = await runGit(projectRoot, ['push']);
    if (push.code !== 0) {
      throw new Error(push.stderr.trim() || 'git push failed');
    }
    gitState.pushed = true;

    const tagName = buildReleaseTagName(tagPrefix, version);
    assertValidGitTag(tagName);

    console.log(`\n[5/6] Creating tag ${tagName}…`);
    const tag = await runGit(projectRoot, [
      'tag',
      '-a',
      tagName,
      '-m',
      `Release ${tagName}`,
    ]);
    if (tag.code !== 0) {
      throw new Error(tag.stderr.trim() || 'git tag failed');
    }
    gitState.tagCreated = true;
    gitState.tagName = tagName;

    console.log('\n[6/6] Pushing tag…');
    const pushTag = await runGit(projectRoot, ['push', 'origin', tagName]);
    if (pushTag.code !== 0) {
      throw new Error(pushTag.stderr.trim() || 'git push tag failed');
    }

    console.log('\nPrepare release completed successfully!');
    console.log(`  Version: ${version}`);
    console.log(`  Tag: ${tagName}`);
    console.log(`  Changelog: ${changelogFrom} .. ${changelogTo}`);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.startsWith('Prepare release failed:')) throw e;
    await rollback(msg);
  }
}
