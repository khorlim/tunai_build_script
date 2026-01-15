#!/usr/bin/env dart

import 'dart:io';
import 'package:path/path.dart' as p;

void main(List<String> arguments) async {
  if (arguments.isEmpty) {
    print(
      'Usage: bump_version.dart [major|minor|patch|build|manual] [--app-dir <path>]',
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
    print(
      '  bump_version.dart manual 1.2.3+5  # Set version to 1.2.3+5 (manual)',
    );
    print('  bump_version.dart patch --app-dir /path/to/app');
    exit(1);
  }

  final bumpType = arguments[0].toLowerCase();
  if (!['major', 'minor', 'patch', 'build', 'manual'].contains(bumpType)) {
    print(
      'Error: Invalid bump type. Must be one of: major, minor, patch, build, manual',
    );
    exit(1);
  }

  // For manual type, require version argument
  String? manualVersion;
  if (bumpType == 'manual') {
    if (arguments.length < 2) {
      print('Error: manual type requires a version argument');
      print('Usage: bump_version.dart manual <version> [--app-dir <path>]');
      print('Example: bump_version.dart manual 1.2.3+5');
      exit(1);
    }
    manualVersion = arguments[1];
    // Validate that the version argument is not --app-dir
    if (manualVersion == '--app-dir') {
      print('Error: manual type requires a version argument before --app-dir');
      print('Usage: bump_version.dart manual <version> [--app-dir <path>]');
      print('Example: bump_version.dart manual 1.2.3+5 --app-dir /path/to/app');
      exit(1);
    }
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
        // Ask if user wants to bump build number
        if (await askToBumpBuildNumber()) {
          newBuildNumber++;
        }
        break;
      case 'minor':
        minor++;
        patch = 0;
        // Ask if user wants to bump build number
        if (await askToBumpBuildNumber()) {
          newBuildNumber++;
        }
        break;
      case 'patch':
        patch++;
        // Ask if user wants to bump build number
        if (await askToBumpBuildNumber()) {
          newBuildNumber++;
        }
        break;
      case 'build':
        newBuildNumber++;
        break;
      case 'manual':
        // Parse manual version
        try {
          final manualParts = manualVersion!.split('+');
          final manualVersionName = manualParts[0];
          final manualBuildNumber = manualParts.length > 1
              ? int.parse(manualParts[1])
              : 1;

          final manualVersionNumbers = manualVersionName
              .split('.')
              .map(int.parse)
              .toList();
          if (manualVersionNumbers.length != 3) {
            print(
              'Error: Invalid manual version format. Expected format: x.y.z or x.y.z+build',
            );
            exit(1);
          }

          major = manualVersionNumbers[0];
          minor = manualVersionNumbers[1];
          patch = manualVersionNumbers[2];
          newBuildNumber = manualBuildNumber;
        } catch (e) {
          print(
            'Error: Invalid manual version format. Expected format: x.y.z or x.y.z+build',
          );
          print('Details: $e');
          exit(1);
        }
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

    // Update iOS Info.plist if it exists
    final iosInfoPlistPath = p.join(appDir, 'ios', 'Runner', 'Info.plist');
    final iosInfoPlistFile = File(iosInfoPlistPath);
    if (await iosInfoPlistFile.exists()) {
      await updateInfoPlist(iosInfoPlistFile, newVersionName, newBuildNumber);
      print('✓ Updated iOS Info.plist');
    } else {
      print('ℹ iOS Info.plist not found at $iosInfoPlistPath (skipping)');
    }

    // Update macOS Info.plist if it exists
    final macosInfoPlistPath = p.join(appDir, 'macos', 'Runner', 'Info.plist');
    final macosInfoPlistFile = File(macosInfoPlistPath);
    if (await macosInfoPlistFile.exists()) {
      await updateInfoPlist(macosInfoPlistFile, newVersionName, newBuildNumber);
      print('✓ Updated macOS Info.plist');
    } else {
      print('ℹ macOS Info.plist not found at $macosInfoPlistPath (skipping)');
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

Future<bool> askToBumpBuildNumber() async {
  stdout.write('Do you want to bump the build number? (y/n): ');
  final input = stdin.readLineSync()?.trim().toLowerCase();
  return input == 'y' || input == 'yes';
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
  // Also supports flutter.versionName references: versionName = flutter.versionName
  final flutterVersionNameMatch = RegExp(
    r'versionName(\s*=?\s*)flutter\.versionName',
  ).firstMatch(content);
  if (flutterVersionNameMatch != null) {
    final assignment = flutterVersionNameMatch.group(1)!;
    content = content.replaceFirst(
      RegExp(r'versionName\s*=?\s*flutter\.versionName'),
      'versionName$assignment"$versionName"',
    );
  } else {
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
  }

  // Update versionCode (supports both Groovy: versionCode 1 and Kotlin DSL: versionCode = 1)
  // Also supports flutter.versionCode references: versionCode = flutter.versionCode
  final flutterVersionCodeMatch = RegExp(
    r'versionCode(\s*=?\s*)flutter\.versionCode',
  ).firstMatch(content);
  if (flutterVersionCodeMatch != null) {
    final assignment = flutterVersionCodeMatch.group(1)!;
    content = content.replaceFirst(
      RegExp(r'versionCode\s*=?\s*flutter\.versionCode'),
      'versionCode$assignment$buildNumber',
    );
  } else {
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
  }

  await buildGradleFile.writeAsString(content);
}
