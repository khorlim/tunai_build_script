#!/usr/bin/env dart

import 'dart:io';
import 'package:path/path.dart' as p;

void main(List<String> arguments) async {
  if (arguments.isEmpty) {
    print(
      'Usage: bump_version.dart [major|minor|patch|build] [--app-dir <path>]',
    );
    print('');
    print('Examples:');
    print(
      '  bump_version.dart patch          # Bump patch version (0.0.1 -> 0.0.2)',
    );
    print(
      '  bump_version.dart minor          # Bump minor version (0.0.1 -> 0.1.0)',
    );
    print(
      '  bump_version.dart major          # Bump major version (0.0.1 -> 1.0.0)',
    );
    print(
      '  bump_version.dart build          # Bump build number (0.0.1+1 -> 0.0.1+2)',
    );
    print('  bump_version.dart patch --app-dir /path/to/app');
    exit(1);
  }

  final bumpType = arguments[0].toLowerCase();
  if (!['major', 'minor', 'patch', 'build'].contains(bumpType)) {
    print(
      'Error: Invalid bump type. Must be one of: major, minor, patch, build',
    );
    exit(1);
  }

  // Get app directory
  String appDir;
  final appDirIndex = arguments.indexOf('--app-dir');
  if (appDirIndex != -1 && appDirIndex + 1 < arguments.length) {
    appDir = arguments[appDirIndex + 1];
  } else {
    appDir = Directory.current.path;
  }

  final appDirFile = Directory(appDir);
  if (!await appDirFile.exists()) {
    print('Error: App directory does not exist: $appDir');
    exit(1);
  }

  print('Bumping $bumpType version in: ${p.absolute(appDir)}');

  try {
    // Read current version from pubspec.yaml
    final pubspecFile = File(p.join(appDir, 'pubspec.yaml'));
    if (!await pubspecFile.exists()) {
      print('Error: pubspec.yaml not found in $appDir');
      exit(1);
    }

    final pubspecContent = await pubspecFile.readAsString();
    final versionMatch = RegExp(r'version:\s*(\S+)').firstMatch(pubspecContent);
    if (versionMatch == null) {
      print('Error: Could not find version in pubspec.yaml');
      exit(1);
    }

    final currentVersion = versionMatch.group(1)!;
    print('Current version: $currentVersion');

    // Parse version
    final versionParts = currentVersion.split('+');
    final versionName = versionParts[0];
    final buildNumber = versionParts.length > 1
        ? int.parse(versionParts[1])
        : 1;

    final versionNumbers = versionName.split('.').map(int.parse).toList();
    if (versionNumbers.length != 3) {
      print(
        'Error: Invalid version format. Expected format: x.y.z or x.y.z+build',
      );
      exit(1);
    }

    var major = versionNumbers[0];
    var minor = versionNumbers[1];
    var patch = versionNumbers[2];
    var newBuildNumber = buildNumber;

    // Bump version
    switch (bumpType) {
      case 'major':
        major++;
        minor = 0;
        patch = 0;
        break;
      case 'minor':
        minor++;
        patch = 0;
        break;
      case 'patch':
        patch++;
        break;
      case 'build':
        newBuildNumber++;
        break;
    }

    final newVersionName = '$major.$minor.$patch';
    final newVersion = newBuildNumber > 1
        ? '$newVersionName+$newBuildNumber'
        : newVersionName;
    print('New version: $newVersion');

    // Update pubspec.yaml
    final newPubspecContent = pubspecContent.replaceFirst(
      RegExp(r'version:\s*\S+'),
      'version: $newVersion',
    );
    await pubspecFile.writeAsString(newPubspecContent);
    print('✓ Updated pubspec.yaml');

    // Update Info.plist if it exists
    final infoPlistPath = p.join(appDir, 'ios', 'Runner', 'Info.plist');
    final infoPlistFile = File(infoPlistPath);
    if (await infoPlistFile.exists()) {
      await updateInfoPlist(infoPlistFile, newVersionName, newBuildNumber);
      print('✓ Updated Info.plist');
    } else {
      print('ℹ Info.plist not found at $infoPlistPath (skipping)');
    }

    // Update build.gradle or build.gradle.kts if it exists
    final buildGradlePath = p.join(appDir, 'android', 'app', 'build.gradle');
    final buildGradleKtsPath = p.join(
      appDir,
      'android',
      'app',
      'build.gradle.kts',
    );
    final buildGradleFile = File(buildGradlePath);
    final buildGradleKtsFile = File(buildGradleKtsPath);

    if (await buildGradleFile.exists()) {
      await updateBuildGradle(buildGradleFile, newVersionName, newBuildNumber);
      print('✓ Updated build.gradle');
    } else if (await buildGradleKtsFile.exists()) {
      await updateBuildGradle(
        buildGradleKtsFile,
        newVersionName,
        newBuildNumber,
      );
      print('✓ Updated build.gradle.kts');
    } else {
      print('ℹ build.gradle/build.gradle.kts not found (skipping)');
    }

    print('\nVersion bump completed successfully!');
  } catch (e, stackTrace) {
    print('Error: $e');
    print(stackTrace);
    exit(1);
  }
}

Future<void> updateInfoPlist(
  File infoPlistFile,
  String versionName,
  int buildNumber,
) async {
  final content = await infoPlistFile.readAsString();

  // Update CFBundleShortVersionString (version name)
  var updatedContent = content.replaceFirst(
    RegExp(
      r'<key>CFBundleShortVersionString</key>\s*<string>[^<]+</string>',
      multiLine: true,
    ),
    '<key>CFBundleShortVersionString</key>\n\t<string>$versionName</string>',
  );

  // Update CFBundleVersion (build number)
  updatedContent = updatedContent.replaceFirst(
    RegExp(
      r'<key>CFBundleVersion</key>\s*<string>[^<]+</string>',
      multiLine: true,
    ),
    '<key>CFBundleVersion</key>\n\t<string>$buildNumber</string>',
  );

  await infoPlistFile.writeAsString(updatedContent);
}

Future<void> updateBuildGradle(
  File buildGradleFile,
  String versionName,
  int buildNumber,
) async {
  var content = await buildGradleFile.readAsString();

  // Update versionName (supports both Groovy: versionName "1.0.0" and Kotlin DSL: versionName = "1.0.0")
  final versionNameMatch = RegExp(
    r'versionName(\s*=?\s*)"[^"]+"',
  ).firstMatch(content);
  if (versionNameMatch != null) {
    final assignment = versionNameMatch.group(1)!;
    content = content.replaceFirst(
      RegExp(r'versionName\s*=?\s*"[^"]+"'),
      'versionName$assignment"$versionName"',
    );
  }

  // Update versionCode (supports both Groovy: versionCode 1 and Kotlin DSL: versionCode = 1)
  final versionCodeMatch = RegExp(
    r'versionCode(\s*=?\s*)\d+',
  ).firstMatch(content);
  if (versionCodeMatch != null) {
    final assignment = versionCodeMatch.group(1)!;
    content = content.replaceFirst(
      RegExp(r'versionCode\s*=?\s*\d+'),
      'versionCode$assignment$buildNumber',
    );
  }

  await buildGradleFile.writeAsString(content);
}
