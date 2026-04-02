import fs from 'fs';
import path from 'path';

export function readPubspec(projectRoot) {
  const pubspecPath = path.join(projectRoot, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) {
    return null;
  }
  const content = fs.readFileSync(pubspecPath, 'utf8');
  return { path: pubspecPath, content };
}

export function getVersionFromPubspecContent(content) {
  const m = content.match(/^\s*version:\s*(\S+)/m);
  return m ? m[1] : null;
}

export function getNameFromPubspecContent(content) {
  const m = content.match(/^\s*name:\s*(\S+)/m);
  return m ? m[1] : null;
}

export function getVersion(projectRoot) {
  const p = readPubspec(projectRoot);
  return p ? getVersionFromPubspecContent(p.content) : null;
}

export function getAppName(projectRoot) {
  const p = readPubspec(projectRoot);
  return p ? getNameFromPubspecContent(p.content) : null;
}
