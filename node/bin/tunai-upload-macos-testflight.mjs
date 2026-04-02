#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findProjectWithConfig, CONFIG_FILENAME } from '../lib/find-project.mjs';
import { loadConfigFile } from '../lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getPackageRoot() {
  return path.join(__dirname, '..', '..');
}

function usage() {
  console.log(`Usage: tunai-upload-macos-testflight [options] [app-dir]

Archives and exports a Flutter macOS app, then uploads to App Store Connect (unless --build-only).

App directory defaults to cwd or the project root that contains ${CONFIG_FILENAME}.

Options:
  --project-root <dir>   Use this Flutter app root (must contain macos/)
  --build-only           Archive & export only; skip altool upload
  --repo-update          Pass --repo-update to pod install
  -h, --help

Environment (for upload):
  ASC_API_KEY_ID, ASC_API_ISSUER_ID, and either API_PRIVATE_KEYS_DIR or ASC_API_KEY_PATH

See scripts/upload_macos_testflight.sh for full details.
`);
}

function parseArgs(argv) {
  const out = {
    projectRoot: null,
    buildOnly: false,
    repoUpdate: false,
    help: false,
    positional: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--project-root') out.projectRoot = argv[++i];
    else if (a === '--build-only') out.buildOnly = true;
    else if (a === '--repo-update') out.repoUpdate = true;
    else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      usage();
      process.exit(1);
    } else {
      out.positional = a;
      break;
    }
  }
  return out;
}

function resolveAppDir(args) {
  if (args.positional) return path.resolve(args.positional);
  if (args.projectRoot) {
    const r = path.resolve(args.projectRoot);
    if (!fs.existsSync(path.join(r, 'macos'))) {
      console.error(`Error: macos/ not found under ${r}`);
      process.exit(1);
    }
    return r;
  }
  const found = findProjectWithConfig(process.cwd());
  if (found) return found.projectRoot;
  return process.cwd();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const appDir = resolveAppDir(args);
  const shellScript = path.join(
    getPackageRoot(),
    'scripts',
    'upload_macos_testflight.sh',
  );
  if (!fs.existsSync(shellScript)) {
    console.error(`Missing script: ${shellScript}`);
    process.exit(1);
  }

  const bashArgs = [shellScript];
  if (args.buildOnly) bashArgs.push('--build-only');
  if (args.repoUpdate) bashArgs.push('--repo-update');
  bashArgs.push(appDir);

  const child = spawn('bash', bashArgs, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...loadMacosEnvFromConfig(appDir),
    },
  });

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  }).then((code) => process.exit(code));
}

/** Optional: read macos_testflight.export_plist / scheme from config (shell uses env SCHEME, EXPORT_PLIST). */
function loadMacosEnvFromConfig(projectRoot) {
  const cfgPath = path.join(projectRoot, CONFIG_FILENAME);
  if (!fs.existsSync(cfgPath)) return {};
  try {
    const config = loadConfigFile(cfgPath);
    const m = config.macos_testflight || {};
    const extra = {};
    if (m.scheme) extra.SCHEME = String(m.scheme);
    if (m.export_plist) {
      extra.EXPORT_PLIST = path.isAbsolute(m.export_plist)
        ? m.export_plist
        : path.join(projectRoot, m.export_plist);
    }
    return extra;
  } catch {
    return {};
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
