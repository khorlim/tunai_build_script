import fs from 'fs';

/**
 * @param {object} params
 * @param {'ios'|'android'} params.platform
 * @param {string} params.buildFilePath
 * @param {string} params.version
 * @param {string} params.bundleIdentifier
 * @param {{ user_id: string, app_id: string, key: string }} params.apphost
 */
export async function uploadToApphost({
  platform,
  buildFilePath,
  version,
  bundleIdentifier,
  apphost,
}) {
  const { user_id: userId, app_id: appId, key } = apphost;
  if (!userId || !appId || !key) {
    throw new Error(
      'Missing apphost.user_id, apphost.app_id, or apphost.key in tunai_build_script_config.json',
    );
  }

  const uploadUrlParams = new URLSearchParams({
    user_id: userId,
    app_id: appId,
    key,
    platform,
    version,
  });
  if (platform === 'ios') {
    uploadUrlParams.set('ios_bundle_identifier', bundleIdentifier);
  } else {
    uploadUrlParams.set('android_package_name', bundleIdentifier);
  }

  console.log('Fetching upload URL...');
  const uploadUrlUri = `https://appho.st/api/get_upload_url?${uploadUrlParams.toString()}`;
  const uploadUrlResponse = await fetch(uploadUrlUri);
  if (!uploadUrlResponse.ok) {
    const body = await uploadUrlResponse.text();
    throw new Error(
      `Error fetching upload URL: ${uploadUrlResponse.status} - ${body}`,
    );
  }

  const uploadUrl = (await uploadUrlResponse.text()).trim();
  if (!uploadUrl.startsWith('https://')) {
    throw new Error(`Error fetching upload URL: ${uploadUrl}`);
  }

  console.log('Uploading file...');
  if (!fs.existsSync(buildFilePath)) {
    throw new Error(`Build file not found: ${buildFilePath}`);
  }

  const fileBytes = fs.readFileSync(buildFilePath);
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(fileBytes.length),
    },
    body: fileBytes,
  });

  if (!uploadResponse.ok) {
    const body = await uploadResponse.text();
    throw new Error(`Error uploading file: ${uploadResponse.status} - ${body}`);
  }

  console.log('File uploaded successfully');

  console.log('Fetching install URL...');
  const installParams = new URLSearchParams({
    u: userId,
    a: appId,
    platform,
  });
  const installUrlUri = `https://appho.st/api/get_current_version/?${installParams.toString()}`;
  const installUrlResponse = await fetch(installUrlUri);
  if (!installUrlResponse.ok) {
    const body = await installUrlResponse.text();
    throw new Error(
      `Error fetching install URL: ${installUrlResponse.status} - ${body}`,
    );
  }

  const installBody = await installUrlResponse.text();
  try {
    const json = JSON.parse(installBody);
    const url = json.url;
    if (typeof url === 'string') return url;
  } catch {
    /* fall through */
  }
  const urlMatch = installBody.match(/"url"\s*:\s*"([^"]+)"/);
  if (urlMatch) return urlMatch[1];
  throw new Error(`Could not parse install URL from response: ${installBody}`);
}
