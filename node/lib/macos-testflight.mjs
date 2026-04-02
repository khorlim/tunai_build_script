import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { interpolateEnv, loadConfigFile } from './config.mjs';
import { CONFIG_FILENAME } from './find-project.mjs';

export function getPackageRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function getMacosTestflight(projectRoot) {
  const cfgPath = path.join(projectRoot, CONFIG_FILENAME);
  if (!fs.existsSync(cfgPath)) return {};
  try {
    const config = loadConfigFile(cfgPath);
    return config.macos_testflight && typeof config.macos_testflight === 'object'
      ? config.macos_testflight
      : {};
  } catch {
    return {};
  }
}

/**
 * Sync env: SCHEME, EXPORT_PLIST, and legacy api_* (only if app_store_key_json_path is not set).
 */
export function loadMacosEnvFromConfig(projectRoot) {
  const m = getMacosTestflight(projectRoot);
  const extra = {};
  if (m.scheme) extra.SCHEME = String(m.scheme).trim();
  if (m.export_plist) {
    const ep = String(m.export_plist).trim();
    if (ep) {
      extra.EXPORT_PLIST = path.isAbsolute(ep)
        ? ep
        : path.join(projectRoot, ep);
    }
  }
  if (m.app_store_key_json_path) {
    return extra;
  }
  const keyId = m.api_key_id != null ? String(m.api_key_id).trim() : '';
  if (keyId) extra.ASC_API_KEY_ID = keyId;
  const issuer = m.api_issuer_id != null ? String(m.api_issuer_id).trim() : '';
  if (issuer) extra.ASC_API_ISSUER_ID = issuer;
  const keyPath = m.api_private_key_path != null
    ? String(m.api_private_key_path).trim()
    : '';
  if (keyPath) {
    const abs = path.isAbsolute(keyPath)
      ? keyPath
      : path.join(projectRoot, keyPath);
    if (!fs.existsSync(abs)) {
      console.warn(
        `Warning: macos_testflight.api_private_key_path not found: ${abs}`,
      );
    }
    extra.ASC_API_KEY_PATH = abs;
  }
  return extra;
}

/**
 * Writes a temp AuthKey_<key_id>.p8 for xcrun altool. Caller must run cleanup after upload.
 * `duration` and `in_house` are accepted in JSON for tooling parity; not used by altool.
 */
export async function materializeAppStoreKeyFromJson(projectRoot, jsonRel) {
  const rel = String(jsonRel).trim();
  const jsonPath = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`app_store_key_json_path not found: ${jsonPath}`);
  }
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  interpolateEnv(data);

  const keyId = data.key_id != null ? String(data.key_id).trim() : '';
  const issuerId = data.issuer_id != null ? String(data.issuer_id).trim() : '';
  let pem = data.key != null ? String(data.key).trim() : '';

  if (!keyId || !issuerId || !pem) {
    throw new Error(
      `App Store key JSON must include key_id, issuer_id, and key (${jsonPath})`,
    );
  }
  if (!pem.includes('BEGIN')) {
    pem = pem.replace(/\\n/g, '\n');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunai-asc-'));
  const p8Name = `AuthKey_${keyId}.p8`;
  const p8Path = path.join(tmpDir, p8Name);
  fs.writeFileSync(p8Path, pem.endsWith('\n') ? pem : `${pem}\n`, 'utf8');

  const cleanup = async () => {
    try {
      fs.unlinkSync(p8Path);
      fs.rmdirSync(tmpDir);
    } catch {
      /* ignore */
    }
  };

  return {
    extraEnv: {
      ASC_API_KEY_ID: keyId,
      ASC_API_ISSUER_ID: issuerId,
      ASC_API_KEY_PATH: p8Path,
    },
    cleanup,
  };
}

/**
 * @param {{ appDir: string, buildOnly?: boolean, repoUpdate?: boolean }} opts
 * @returns {Promise<number>} exit code
 */
export async function runMacosTestflightScript(opts) {
  const { appDir, buildOnly, repoUpdate } = opts;
  const shellScript = path.join(
    getPackageRoot(),
    'scripts',
    'upload_macos_testflight.sh',
  );
  if (!fs.existsSync(shellScript)) {
    throw new Error(`Missing script: ${shellScript}`);
  }

  const m = getMacosTestflight(appDir);
  let cleanup = async () => {};

  const baseEnv = {
    ...process.env,
    ...loadMacosEnvFromConfig(appDir),
  };

  if (!buildOnly && m.app_store_key_json_path) {
    const { extraEnv, cleanup: c } = await materializeAppStoreKeyFromJson(
      appDir,
      m.app_store_key_json_path,
    );
    Object.assign(baseEnv, extraEnv);
    cleanup = c;
  }

  const bashArgs = [shellScript];
  if (buildOnly) bashArgs.push('--build-only');
  if (repoUpdate) bashArgs.push('--repo-update');
  bashArgs.push(appDir);

  return new Promise((resolve, reject) => {
    const child = spawn('bash', bashArgs, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: baseEnv,
    });
    child.on('error', async (err) => {
      try {
        await cleanup();
      } catch {
        /* ignore */
      }
      reject(err);
    });
    child.on('close', async (code) => {
      try {
        await cleanup();
      } catch {
        /* ignore */
      }
      resolve(code ?? 1);
    });
  });
}
