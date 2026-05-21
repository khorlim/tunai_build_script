import fs from 'fs';
import path from 'path';
import {
  getNameFromPubspecContent,
  getVersionFromPubspecContent,
  readPubspec,
} from './pubspec.mjs';

function cleanInfoValue(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || /^\$\([^)]+\)$/.test(v)) return null;
  return v;
}

function decodeXmlEntities(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function getPubspecDescription(content) {
  const m = content.match(/^\s*description:\s*(.+)$/m);
  return m ? cleanInfoValue(m[1].replace(/^['"]|['"]$/g, '')) : null;
}

function readAndroidStringResource(projectRoot, resourceName) {
  const valuesDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'res',
    'values',
  );
  if (!fs.existsSync(valuesDir)) return null;
  for (const name of fs.readdirSync(valuesDir)) {
    if (!name.endsWith('.xml')) continue;
    const file = path.join(valuesDir, name);
    const content = fs.readFileSync(file, 'utf8');
    const escaped = resourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `<string\\s+[^>]*name=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/string>`,
    );
    const m = content.match(re);
    if (m) return cleanInfoValue(decodeXmlEntities(m[1]));
  }
  return null;
}

function getAndroidDisplayName(projectRoot) {
  const manifestPath = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'AndroidManifest.xml',
  );
  if (!fs.existsSync(manifestPath)) return null;
  const content = fs.readFileSync(manifestPath, 'utf8');
  const m = content.match(/<application\b[^>]*\bandroid:label=["']([^"']+)["']/);
  const label = m ? decodeXmlEntities(m[1]) : null;
  const resource = label?.match(/^@string\/(.+)$/);
  if (resource) return readAndroidStringResource(projectRoot, resource[1]);
  return cleanInfoValue(label);
}

function getPlistStringValue(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<key>\\s*${escaped}\\s*<\\/key>\\s*<string>([\\s\\S]*?)<\\/string>`,
  );
  const m = content.match(re);
  return m ? cleanInfoValue(decodeXmlEntities(m[1])) : null;
}

function getAppleDisplayName(projectRoot) {
  const plistPath = path.join(projectRoot, 'ios', 'Runner', 'Info.plist');
  if (!fs.existsSync(plistPath)) return null;
  const content = fs.readFileSync(plistPath, 'utf8');
  return (
    getPlistStringValue(content, 'CFBundleDisplayName') ||
    getPlistStringValue(content, 'CFBundleName')
  );
}

export function getAppInfo(projectRoot, platform) {
  const pubspec = readPubspec(projectRoot);
  const content = pubspec?.content ?? '';
  const pubspecName = content ? getNameFromPubspecContent(content) : null;
  const version = content ? getVersionFromPubspecContent(content) : null;
  const description = content ? getPubspecDescription(content) : null;
  const displayName =
    platform === 'android'
      ? getAndroidDisplayName(projectRoot)
      : platform === 'ios'
        ? getAppleDisplayName(projectRoot)
        : null;
  const appName = displayName || pubspecName || 'App';

  return {
    name: pubspecName,
    display_name: displayName,
    app_group: appName,
    release_version: version,
    title: `${appName} ${version ?? ''}`.trim(),
    notes: description || undefined,
  };
}
