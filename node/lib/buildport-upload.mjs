import fs from 'fs';
import os from 'os';
import { Agent } from 'undici';
import { spawnSync } from 'child_process';
import path from 'path';

// BUILDPORT_BASE_URL points the CLI at another BuildPort, for example a local
// instance while testing BuildPort changes.
export const BUILDPORT_BASE_URL = (
  process.env.BUILDPORT_BASE_URL?.trim() || 'https://support.tunai.io/buildport'
).replace(/\/+$/, '');
const UPLOAD_URL = `${BUILDPORT_BASE_URL}/api/releases`;

/**
 * @param {object} params
 * @param {string} params.buildFilePath
 * @param {string} params.version
 * @param {{
 *   app_group?: string,
 *   release_version?: string,
 *   title?: string,
 * }} params.appInfo
 * @param {{
 *   api_token: string,
 *   app_group?: string,
 *   track?: string,
 *   timeout_seconds: number,
 * }} params.buildport
 * @param {string} [params.notes] Markdown release notes shown to testers.
 * @returns {Promise<{ url: string, response: object }>} Tester URL for the
 *   build's track, plus the parsed Buildport response (app_name, track,
 *   release_version, notes, artifacts).
 */
export async function uploadToBuildport({
  buildFilePath,
  version,
  appInfo,
  buildport,
  notes,
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

  const track = buildport.track;
  if (appGroup) {
    form.append('app_group', appGroup);
  }
  if (track) {
    form.append('track', track);
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
    if (track) curlArgs.push('-F', `track=${track}`);
    // curl -F treats a value starting with @ or < as a file, so notes go
    // through a temporary file read with <.
    let notesFile = null;
    if (notes != null && notes !== '') {
      notesFile = path.join(os.tmpdir(), `buildport-notes-${process.pid}-${Date.now()}.md`);
      fs.writeFileSync(notesFile, notes, { encoding: 'utf8', mode: 0o600 });
      curlArgs.push('-F', `notes=<${notesFile}`);
    }
    curlArgs.push('-F', `apps=@${buildFilePath}`, UPLOAD_URL);
    let r;
    try {
      r = spawnSync('curl', curlArgs, {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
    } finally {
      if (notesFile) fs.rmSync(notesFile, { force: true });
    }
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
    return { url: curlUrl.trim(), response: json };
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
  return { url: url.trim(), response: json };
}

/**
 * Replace the notes of an uploaded BuildPort build.
 *
 * @param {{ api_token: string, timeout_seconds?: number }} buildport
 * @param {string} releaseToken  `token` from the upload response
 * @param {string} notes  Markdown; an empty string clears the notes
 * @returns {Promise<object>} Updated build, same shape as the upload response
 */
export async function updateBuildportNotes(buildport, releaseToken, notes) {
  if (!buildport?.api_token) {
    throw new Error(
      'Missing buildport.api_token in tunai_build_script_config.json or BUILDPORT_API_TOKEN in the environment',
    );
  }
  const token = String(releaseToken || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error(`Invalid BuildPort build token: ${releaseToken}`);
  }
  const response = await fetch(`${UPLOAD_URL}/${token}/notes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${buildport.api_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ notes }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(`BuildPort notes update failed: ${response.status} - ${json?.error || text.slice(0, 300)}`);
  }
  return json;
}
