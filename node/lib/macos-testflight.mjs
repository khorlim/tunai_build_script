import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfigFile } from './config.mjs';
import { CONFIG_FILENAME } from './find-project.mjs';

export function getPackageRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** Optional SCHEME / EXPORT_PLIST from tunai_build_script_config.json */
export function loadMacosEnvFromConfig(projectRoot) {
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

/**
 * @param {{ appDir: string, buildOnly?: boolean, repoUpdate?: boolean }} opts
 * @returns {Promise<number>} exit code
 */
export function runMacosTestflightScript(opts) {
  const { appDir, buildOnly, repoUpdate } = opts;
  const shellScript = path.join(
    getPackageRoot(),
    'scripts',
    'upload_macos_testflight.sh',
  );
  if (!fs.existsSync(shellScript)) {
    throw new Error(`Missing script: ${shellScript}`);
  }

  const bashArgs = [shellScript];
  if (buildOnly) bashArgs.push('--build-only');
  if (repoUpdate) bashArgs.push('--repo-update');
  bashArgs.push(appDir);

  return new Promise((resolve, reject) => {
    const child = spawn('bash', bashArgs, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...loadMacosEnvFromConfig(appDir),
      },
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}
