import fs from 'fs';
import path from 'path';

const UPLOAD_URL = 'https://api.loadly.io/apiv2/app/upload';
const LOADLY_INSTALL_BASE = 'https://i.loadly.io';

/**
 * @param {string | undefined} keyOrSuffix
 * @returns {string | null}
 */
function resolveLoadlyInstallUrl(keyOrSuffix) {
  if (keyOrSuffix == null || keyOrSuffix === '') return null;
  const s = String(keyOrSuffix).trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return `${LOADLY_INSTALL_BASE}/${s.replace(/^\//, '')}`;
}

/**
 * @param {object} params
 * @param {string} params.buildFilePath
 * @param {{
 *   api_key: string,
 *   build_password?: string,
 *   build_update_description?: string,
 *   build_install_type?: number,
 *   build_channel_shortcut?: string,
 *   timeout_seconds: number,
 * }} params.loadly
 * @returns {Promise<string>} Primary install / share URL (shortcut page when available)
 */
export async function uploadToLoadly({ buildFilePath, loadly }) {
  const apiKey = loadly.api_key;
  if (!apiKey) {
    throw new Error(
      'Missing loadly.api_key in tunai_build_script_config.json',
    );
  }

  if (!fs.existsSync(buildFilePath)) {
    throw new Error(`Build file not found: ${buildFilePath}`);
  }

  const form = new FormData();
  form.append('_api_key', apiKey);
  const fileBytes = fs.readFileSync(buildFilePath);
  const blob = new Blob([fileBytes]);
  form.append('file', blob, path.basename(buildFilePath));

  if (loadly.build_password) {
    form.append('buildPassword', loadly.build_password);
  }
  if (
    loadly.build_update_description != null &&
    loadly.build_update_description !== ''
  ) {
    form.append(
      'buildUpdateDescription',
      loadly.build_update_description,
    );
  }
  if (loadly.build_install_type != null) {
    form.append('buildInstallType', String(loadly.build_install_type));
  }
  if (loadly.build_channel_shortcut) {
    form.append('buildChannelShortcut', loadly.build_channel_shortcut);
  }

  const timeoutMs = loadly.timeout_seconds * 1000;
  console.log('Uploading to Loadly...');

  const uploadResponse = await fetch(UPLOAD_URL, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const bodyText = await uploadResponse.text();
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `Loadly upload: expected JSON (${uploadResponse.status}): ${bodyText.slice(0, 500)}`,
    );
  }

  const code = json.code;
  if (code !== undefined && code !== 0 && code !== '0') {
    const msg = json.message || json.msg || bodyText;
    throw new Error(`Loadly upload failed (code ${code}): ${msg}`);
  }

  if (!uploadResponse.ok) {
    const msg = json.message || json.msg || bodyText;
    throw new Error(`Loadly upload failed: ${uploadResponse.status} - ${msg}`);
  }

  const data = json.data;
  if (!data || typeof data !== 'object') {
    throw new Error(
      `Loadly upload: missing data in response: ${bodyText.slice(0, 500)}`,
    );
  }

  const shortcutUrl = resolveLoadlyInstallUrl(data.buildShortcutUrl);
  const keyUrl = resolveLoadlyInstallUrl(data.buildKey);
  const installUrl = shortcutUrl || keyUrl;
  if (!installUrl) {
    throw new Error(
      'Loadly upload: response had no buildShortcutUrl or buildKey',
    );
  }

  if (data.buildQRCodeURL) {
    console.log(`QR code: ${data.buildQRCodeURL}`);
  }

  console.log('File uploaded successfully');
  return installUrl;
}
