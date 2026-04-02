import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

function parseVersion(current) {
  const parts = current.split('+');
  const versionName = parts[0];
  const buildNumber = parts.length > 1 ? parseInt(parts[1], 10) : 1;
  const nums = versionName.split('.').map((n) => parseInt(n, 10));
  if (nums.length !== 3 || nums.some((n) => Number.isNaN(n))) {
    throw new Error(
      'Invalid version format. Expected x.y.z or x.y.z+build in pubspec.yaml',
    );
  }
  return { major: nums[0], minor: nums[1], patch: nums[2], buildNumber };
}

async function askBumpBuild() {
  if (!input.isTTY) return false;
  const rl = readline.createInterface({ input, output });
  try {
    const ans = (await rl.question('Do you want to bump the build number? (y/n): '))
      .trim()
      .toLowerCase();
    return ans === 'y' || ans === 'yes';
  } finally {
    rl.close();
  }
}

function updateInfoPlist(content, versionName, buildNumber) {
  let updated = content.replace(
    /<key>CFBundleShortVersionString<\/key>\s*<string>[^<]+<\/string>/,
    `<key>CFBundleShortVersionString</key>\n\t<string>${versionName}</string>`,
  );
  updated = updated.replace(
    /<key>CFBundleVersion<\/key>\s*<string>[^<]+<\/string>/,
    `<key>CFBundleVersion</key>\n\t<string>${buildNumber}</string>`,
  );
  return updated;
}

function updateBuildGradle(content, versionName, buildNumber) {
  let c = content;

  const flutterName = c.match(
    /versionName(\s*=?\s*)flutter\.versionName/,
  );
  if (flutterName) {
    const assign = flutterName[1];
    c = c.replace(
      /versionName\s*=?\s*flutter\.versionName/,
      `versionName${assign}"${versionName}"`,
    );
  } else {
    const m = c.match(/versionName(\s*=?\s*)"[^"]+"/);
    if (m) {
      const assign = m[1];
      c = c.replace(
        /versionName\s*=?\s*"[^"]+"/,
        `versionName${assign}"${versionName}"`,
      );
    }
  }

  const flutterCode = c.match(/versionCode(\s*=?\s*)flutter\.versionCode/);
  if (flutterCode) {
    const assign = flutterCode[1];
    c = c.replace(
      /versionCode\s*=?\s*flutter\.versionCode/,
      `versionCode${assign}${buildNumber}`,
    );
  } else {
    const m = c.match(/versionCode(\s*=?\s*)\d+/);
    if (m) {
      const assign = m[1];
      c = c.replace(
        /versionCode\s*=?\s*\d+/,
        `versionCode${assign}${buildNumber}`,
      );
    }
  }

  return c;
}

/**
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.bumpType major|minor|patch|build|manual
 * @param {string} [opts.manualVersion]
 * @param {boolean} [opts.yes] always bump build for major/minor/patch
 * @param {boolean} [opts.noBumpBuild] never bump build for major/minor/patch
 */
export async function bumpVersion({
  projectRoot,
  bumpType,
  manualVersion,
  yes,
  noBumpBuild,
}) {
  const pubspecPath = path.join(projectRoot, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) {
    throw new Error(`pubspec.yaml not found in ${projectRoot}`);
  }

  let pubspecContent = fs.readFileSync(pubspecPath, 'utf8');
  const versionMatch = pubspecContent.match(/^\s*version:\s*(\S+)/m);
  if (!versionMatch) {
    throw new Error('Could not find version in pubspec.yaml');
  }

  const currentVersion = versionMatch[1];
  console.log(`Current version: ${currentVersion}`);

  let { major, minor, patch, buildNumber } = parseVersion(currentVersion);
  let newBuildNumber = buildNumber;

  const shouldAskBuild = () => {
    if (yes) return true;
    if (noBumpBuild) return false;
    return askBumpBuild();
  };

  switch (bumpType) {
    case 'major':
      major += 1;
      minor = 0;
      patch = 0;
      if (await shouldAskBuild()) newBuildNumber += 1;
      break;
    case 'minor':
      minor += 1;
      patch = 0;
      if (await shouldAskBuild()) newBuildNumber += 1;
      break;
    case 'patch':
      patch += 1;
      if (await shouldAskBuild()) newBuildNumber += 1;
      break;
    case 'build':
      newBuildNumber += 1;
      break;
    case 'manual': {
      const mv = manualVersion;
      if (!mv) throw new Error('manual bump requires a version argument');
      const mp = mv.split('+');
      const name = mp[0];
      const b = mp.length > 1 ? parseInt(mp[1], 10) : 1;
      const nums = name.split('.').map((n) => parseInt(n, 10));
      if (nums.length !== 3 || nums.some((n) => Number.isNaN(n)) || Number.isNaN(b)) {
        throw new Error(
          'Invalid manual version. Expected x.y.z or x.y.z+build',
        );
      }
      [major, minor, patch] = nums;
      newBuildNumber = b;
      break;
    }
    default:
      throw new Error(`Unknown bump type: ${bumpType}`);
  }

  const versionName = `${major}.${minor}.${patch}`;
  const newVersion =
    newBuildNumber > 1 ? `${versionName}+${newBuildNumber}` : versionName;
  console.log(`New version: ${newVersion}`);

  pubspecContent = pubspecContent.replace(
    /^\s*version:\s*\S+/m,
    `version: ${newVersion}`,
  );
  fs.writeFileSync(pubspecPath, pubspecContent);
  console.log('✓ Updated pubspec.yaml');

  const iosPlist = path.join(projectRoot, 'ios', 'Runner', 'Info.plist');
  if (fs.existsSync(iosPlist)) {
    const pl = fs.readFileSync(iosPlist, 'utf8');
    fs.writeFileSync(iosPlist, updateInfoPlist(pl, versionName, newBuildNumber));
    console.log('✓ Updated iOS Info.plist');
  } else {
    console.log(`ℹ iOS Info.plist not found at ${iosPlist} (skipping)`);
  }

  const macPlist = path.join(projectRoot, 'macos', 'Runner', 'Info.plist');
  if (fs.existsSync(macPlist)) {
    const pl = fs.readFileSync(macPlist, 'utf8');
    fs.writeFileSync(macPlist, updateInfoPlist(pl, versionName, newBuildNumber));
    console.log('✓ Updated macOS Info.plist');
  } else {
    console.log(`ℹ macOS Info.plist not found at ${macPlist} (skipping)`);
  }

  const gradle = path.join(projectRoot, 'android', 'app', 'build.gradle');
  const gradleKts = path.join(projectRoot, 'android', 'app', 'build.gradle.kts');
  if (fs.existsSync(gradle)) {
    const g = fs.readFileSync(gradle, 'utf8');
    fs.writeFileSync(gradle, updateBuildGradle(g, versionName, newBuildNumber));
    console.log('✓ Updated build.gradle');
  } else if (fs.existsSync(gradleKts)) {
    const g = fs.readFileSync(gradleKts, 'utf8');
    fs.writeFileSync(gradleKts, updateBuildGradle(g, versionName, newBuildNumber));
    console.log('✓ Updated build.gradle.kts');
  } else {
    console.log('ℹ build.gradle/build.gradle.kts not found (skipping)');
  }

  console.log('\nVersion bump completed successfully!');
}
