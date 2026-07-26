import fs from 'fs';
import { Agent } from 'undici';
import { spawnSync } from 'child_process';
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
 *   app_group?: string,
 *   timeout_seconds: number,
 * }} params.buildport
 * @param {{ text: string, pr_number?: string, pr_url?: string }[]} [params.changes]
 *   Checklist entries shown on the tester page (usually one per PR).
 * @returns {Promise<string>} Tester share URL
 */
export async function uploadToBuildport({
  buildFilePath,
  version,
  appInfo,
  buildport,
  changes,
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
  const appGroup = buildport.app_group || appInfo.app_group;
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
  if (Array.isArray(changes) && changes.length > 0) {
    form.append('changes', JSON.stringify(changes));
  }

  const fileBytes = fs.readFileSync(buildFilePath);
  const blob = new Blob([fileBytes]);
  form.append('apps', blob, path.basename(buildFilePath));

  console.log('Uploading to Buildport...');
  const curlUpload = () => {
    const curlArgs = [
      '-sS',
      '--max-time',
      String(buildport.timeout_seconds),
      '-H',
      `Authorization: Bearer ${apiToken}`,
      '-F',
      `release_version=${releaseVersion}`,
      '-F',
      `title=${title}`,
    ];
    if (appGroup) curlArgs.push('-F', `app_group=${appGroup}`);
    if (notes != null && notes !== '') curlArgs.push('-F', `notes=${notes}`);
    if (Array.isArray(changes) && changes.length > 0) {
      curlArgs.push('-F', `changes=${JSON.stringify(changes)}`);
    }
    curlArgs.push('-F', `apps=@${buildFilePath}`, UPLOAD_URL);
    const r = spawnSync('curl', curlArgs, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (r.status !== 0) {
      throw new Error(`curl upload failed: ${r.stderr?.trim() || r.status}`);
    }
    return r.stdout;
  };
  // undici's default headersTimeout (300s) fires independently of the abort
  // signal; large IPAs can exceed it while Buildport processes the upload.
  const timeoutMs = buildport.timeout_seconds * 1000;
  const dispatcher = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  let uploadResponse = null;
  try {
    uploadResponse = await fetch(UPLOAD_URL, {
      dispatcher,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      body: form,
      signal: AbortSignal.timeout(buildport.timeout_seconds * 1000),
    });
  } catch (fetchErr) {
    console.warn(
      `Buildport fetch upload failed (${fetchErr?.cause?.code || fetchErr?.name || fetchErr}); falling back to curl…`,
    );
    const stdout = curlUpload();
    let json = null;
    try {
      json = JSON.parse(stdout);
    } catch {
      throw new Error(
        `Buildport curl upload: expected JSON response: ${stdout.slice(0, 500)}`,
      );
    }
    const curlUrl = json?.url;
    if (typeof curlUrl !== 'string' || !curlUrl.trim()) {
      throw new Error(
        `Buildport curl upload: response had no url: ${stdout.slice(0, 500)}`,
      );
    }
    console.log('File uploaded successfully (curl fallback)');
    return curlUrl.trim();
  }

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
