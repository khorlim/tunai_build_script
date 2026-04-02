#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { findProjectWithConfig, CONFIG_FILENAME } from '../lib/find-project.mjs';
import { bumpVersion } from '../lib/bump.mjs';

function usage() {
  console.log(`Usage: tunai-bump-version <major|minor|patch|build|manual> [version] [options]

  tunai-bump-version patch
  tunai-bump-version minor
  tunai-bump-version major
  tunai-bump-version build
  tunai-bump-version manual 1.2.3+5

Options:
  --project-root <dir>   Flutter project root (folder containing pubspec.yaml;
                         if it also has ${CONFIG_FILENAME}, that root is used when found via walk-up)
  --yes                  For major/minor/patch, also bump build number without prompting
  --no-bump-build        For major/minor/patch, never bump build number (non-interactive default)
  -h, --help
`);
}

function resolveRoot(explicit) {
  if (explicit) {
    const root = path.resolve(explicit);
    if (!fs.existsSync(path.join(root, 'pubspec.yaml'))) {
      console.error(`Error: pubspec.yaml not found in ${root}`);
      process.exit(1);
    }
    return root;
  }
  const found = findProjectWithConfig(process.cwd());
  if (found) return found.projectRoot;
  let dir = process.cwd();
  const { root: fsRoot } = path.parse(dir);
  while (true) {
    if (fs.existsSync(path.join(dir, 'pubspec.yaml'))) return dir;
    if (dir === fsRoot) break;
    dir = path.dirname(dir);
  }
  console.error(
    'Error: Could not find pubspec.yaml. Pass --project-root or run from your Flutter app.',
  );
  process.exit(1);
}

async function main() {
  const raw = process.argv.slice(2);
  if (!raw.length || raw.includes('-h') || raw.includes('--help')) {
    usage();
    process.exit(raw.length ? 0 : 1);
  }

  let projectRoot = null;
  let yes = false;
  let noBumpBuild = false;
  const pos = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '--project-root') {
      projectRoot = raw[++i];
    } else if (a === '--yes') {
      yes = true;
    } else if (a === '--no-bump-build') {
      noBumpBuild = true;
    } else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      usage();
      process.exit(1);
    } else {
      pos.push(a);
    }
  }

  const bumpType = pos[0]?.toLowerCase();
  if (!['major', 'minor', 'patch', 'build', 'manual'].includes(bumpType)) {
    console.error('Error: First argument must be major, minor, patch, build, or manual');
    usage();
    process.exit(1);
  }

  let manualVersion;
  if (bumpType === 'manual') {
    manualVersion = pos[1];
    if (!manualVersion || manualVersion.startsWith('--')) {
      console.error('Error: manual requires a version like 1.2.3+5');
      process.exit(1);
    }
  }

  const root = resolveRoot(projectRoot);
  console.log(`Bumping ${bumpType} in: ${path.resolve(root)}`);

  await bumpVersion({
    projectRoot: root,
    bumpType,
    manualVersion,
    yes,
    noBumpBuild,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
