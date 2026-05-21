import fs from 'fs';
import path from 'path';

const UPLOAD_URL = 'https://support.tunai.io/buildport/api/releases';

/**
 * @param {object} params
 * @param {string} params.buildFilePath
 * @param {string} params.version
 * @param {{
 *   app_group?: string,
 *   release_version?: string,
 *   title?: string,
 *   notes?: string,
 * }} params.appInfo
 * @param {{
 *   api_token: string,
 *   timeout_seconds: number,
 * }} params.buildport
 * @returns {Promise<string>} Tester share URL
 */
export async function uploadToBuildport({
  buildFilePath,
  version,
  appInfo,
  buildport,
}) {
  const apiToken = buildport.api_token;
  if (!apiToken) {
    throw new Error(
      'Missing buildport.api_token in tunai_build_script_config.json or BUILDPORT_API_TOKEN in the environment',
    );
  }

  if (!fs.existsSync(buildFilePath)) {
    throw new Error(`Build file not found: ${buildFilePath}`);
  }

  const form = new FormData();
  const appGroup = appInfo.app_group;
  const releaseVersion = appInfo.release_version || version;
  const title = appInfo.title || appGroup || 'App';
  const notes = appInfo.notes;

  if (appGroup) {
    form.append('app_group', appGroup);
  }
  form.append('release_version', releaseVersion);
  form.append('title', title);
  if (notes != null && notes !== '') {
    form.append('notes', notes);
  }

  const fileBytes = fs.readFileSync(buildFilePath);
  const blob = new Blob([fileBytes]);
  form.append('apps', blob, path.basename(buildFilePath));

  console.log('Uploading to Buildport...');
  const uploadResponse = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    body: form,
    signal: AbortSignal.timeout(buildport.timeout_seconds * 1000),
  });

  const bodyText = await uploadResponse.text();
  let json = null;
  if (bodyText.trim()) {
    try {
      json = JSON.parse(bodyText);
    } catch {
      if (!uploadResponse.ok) {
        throw new Error(
          `Buildport upload failed: ${uploadResponse.status} - ${bodyText.slice(0, 500)}`,
        );
      }
      throw new Error(
        `Buildport upload: expected JSON response: ${bodyText.slice(0, 500)}`,
      );
    }
  }

  if (!uploadResponse.ok) {
    const msg = json?.message || json?.error || bodyText;
    throw new Error(`Buildport upload failed: ${uploadResponse.status} - ${msg}`);
  }

  const url = json?.url;
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error(
      `Buildport upload: response had no url: ${bodyText.slice(0, 500)}`,
    );
  }

  console.log('File uploaded successfully');
  return url.trim();
}
