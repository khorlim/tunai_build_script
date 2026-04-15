import fs from 'fs';
import path from 'path';

export function findIpaFile(projectRoot) {
  const ipaDir = path.join(projectRoot, 'build', 'ios', 'ipa');
  if (!fs.existsSync(ipaDir)) return null;
  const entries = fs.readdirSync(ipaDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.ipa')) {
      return path.join(ipaDir, e.name);
    }
  }
  return null;
}

export function findAndroidBuildFile(projectRoot) {
  const bundleDir = path.join(
    projectRoot,
    'build',
    'app',
    'outputs',
    'bundle',
    'release',
  );
  if (fs.existsSync(bundleDir)) {
    for (const name of fs.readdirSync(bundleDir)) {
      if (name.endsWith('.aab')) {
        return path.join(bundleDir, name);
      }
    }
  }

  const flutterApk = path.join(
    projectRoot,
    'build',
    'app',
    'outputs',
    'flutter-apk',
  );
  if (fs.existsSync(flutterApk)) {
    const releaseApkPath = path.join(flutterApk, 'app-release.apk');
    if (fs.existsSync(releaseApkPath)) {
      return releaseApkPath;
    }
    for (const name of fs.readdirSync(flutterApk)) {
      if (name.endsWith('.apk')) {
        return path.join(flutterApk, name);
      }
    }
  }

  const releaseApk = path.join(
    projectRoot,
    'build',
    'app',
    'outputs',
    'apk',
    'release',
  );
  if (fs.existsSync(releaseApk)) {
    for (const name of fs.readdirSync(releaseApk)) {
      if (name.endsWith('.apk')) {
        return path.join(releaseApk, name);
      }
    }
  }

  return null;
}
