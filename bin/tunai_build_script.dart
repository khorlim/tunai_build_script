import 'dart:io';
import 'dart:convert';
import 'package:path/path.dart' as p;
import 'package:flutter_app_host/flutter_app_host.dart' as host;

String? _appDir;
String? _packageDir;
String? _platform;

void main(List<String> arguments) async {
  // Get the package directory (parent of bin directory)
  final scriptPath = Platform.script.toFilePath();
  _packageDir = p.dirname(p.dirname(scriptPath));
  try {
    // Parse app directory from arguments
    _appDir = _parseAppDir(arguments);

    if (_appDir != null) {
      // Validate that the app directory exists
      final appDirFile = Directory(_appDir!);
      if (!await appDirFile.exists()) {
        print('Error: App directory does not exist: $_appDir');
        exit(1);
      }
      print('Using app directory: ${p.absolute(_appDir!)}');
    } else {
      // Default to current directory
      _appDir = Directory.current.path;
      print('Using current directory as app directory');
    }

    // Parse platform from arguments or auto-detect
    _platform = _parsePlatform(arguments);
    if (_platform == null) {
      _platform = await _detectPlatform();
    }
    if (_platform == null) {
      print(
        'Error: Could not determine platform. Please specify --platform ios or --platform android',
      );
      exit(1);
    }
    print('Using platform: $_platform');

    if (arguments.contains('--upload')) {
      // Perform only upload if '--upload' is passed
      await performUpload();
    } else {
      bool update = arguments.contains('--update');
      await performBuild(update: update);
    }
  } catch (e) {
    print('An error occurred: $e');
    exit(1);
  }
}

String? _parseAppDir(List<String> arguments) {
  final appDirIndex = arguments.indexOf('--app-dir');
  if (appDirIndex != -1 && appDirIndex + 1 < arguments.length) {
    return arguments[appDirIndex + 1];
  }

  final pathIndex = arguments.indexOf('--path');
  if (pathIndex != -1 && pathIndex + 1 < arguments.length) {
    return arguments[pathIndex + 1];
  }

  return null;
}

String? _parsePlatform(List<String> arguments) {
  final platformIndex = arguments.indexOf('--platform');
  if (platformIndex != -1 && platformIndex + 1 < arguments.length) {
    final platform = arguments[platformIndex + 1].toLowerCase();
    if (platform == 'ios' || platform == 'android') {
      return platform;
    } else {
      print(
        'Warning: Invalid platform "$platform". Must be "ios" or "android"',
      );
      return null;
    }
  }
  return null;
}

Future<String?> _detectPlatform() async {
  // Check if iOS directory exists
  final iosDir = Directory(_getAppPath('ios'));
  final androidDir = Directory(_getAppPath('android'));

  final iosExists = await iosDir.exists();
  final androidExists = await androidDir.exists();

  if (iosExists && androidExists) {
    // Both exist, can't auto-detect
    return null;
  } else if (iosExists) {
    return 'ios';
  } else if (androidExists) {
    return 'android';
  }

  return null;
}

String _getAppPath(String relativePath) {
  return p.join(_appDir!, relativePath);
}

Future<void> performBuild({bool update = true}) async {
  try {
    print('Starting the build process for $_platform...');

    if (update) {
      final gitPullExitCode = await runCommandInAppDir('git', ['pull']);
      if (gitPullExitCode != 0) {
        print('Warning: git pull failed with exit code $gitPullExitCode');
      }

      final gitSubmoduleExitCode = await runCommandInAppDir('git', [
        'submodule',
        'update',
      ]);
      if (gitSubmoduleExitCode != 0) {
        print(
          'Warning: git submodule update failed with exit code $gitSubmoduleExitCode',
        );
      }

      final pubGetExitCode = await runCommandInAppDir('flutter', [
        'pub',
        'get',
      ]);
      if (pubGetExitCode != 0) {
        throw Exception(
          'flutter pub get failed with exit code $pubGetExitCode',
        );
      }
    }

    final buildExitCode = await _buildForPlatform();
    if (buildExitCode != 0) {
      throw Exception('flutter build failed with exit code $buildExitCode');
    }

    await performUpload();

    print('Build and upload process completed successfully!');
  } catch (e) {
    print('An error occurred during build: $e');
    exit(1);
  }
}

Future<int> _buildForPlatform() async {
  if (_platform == 'ios') {
    return await _buildIos();
  } else if (_platform == 'android') {
    return await _buildAndroid();
  } else {
    throw Exception('Unknown platform: $_platform');
  }
}

Future<int> _buildIos() async {
  // Check if ExportOptions.plist exists
  final exportOptionsFile = File(_getAppPath('ios/ExportOptions.plist'));
  final exportOptionsExists = await exportOptionsFile.exists();

  final buildArgs = <String>['build', 'ipa'];
  if (exportOptionsExists) {
    final exportOptionsPath = _getAppPath('ios/ExportOptions.plist');
    buildArgs.addAll(['--export-options-plist', exportOptionsPath]);
    print('Using ExportOptions.plist for IPA export');
  } else {
    print(
      'Warning: ios/ExportOptions.plist not found, building without export options',
    );
  }

  return await runCommandInAppDir('flutter', buildArgs);
}

Future<int> _buildAndroid() async {
  final buildArgs = <String>['build', 'apk'];
  print('Building Android APK for Play Store');

  return await runCommandInAppDir('flutter', buildArgs);
}

Future<void> performUpload() async {
  try {
    print('Starting the upload process for $_platform...');

    // 1. Get the version from pubspec.yaml
    final version = await getVersionFromPubspec();
    if (version == null) {
      print('Error: Could not find version in pubspec.yaml');
      print('Make sure the app directory contains a valid pubspec.yaml file');
      exit(1);
    }

    final platform = _platform!; // Already validated in main()
    String? bundleIdentifier;
    String buildFilePath;

    if (platform == 'ios') {
      // 2. Get the iOS bundle identifier from .apphost
      final iosBundleId = await getIosBundleIdentifierFromConfig();
      if (iosBundleId == null) {
        print('Error: Could not find iOS bundle identifier in .apphost');
        print(
          'Make sure .apphost file exists in the app directory with ios_bundle_identifier field',
        );
        exit(1);
      }
      bundleIdentifier = iosBundleId;

      // 3. Find IPA file path dynamically
      final ipaFile = await findIpaFile();
      if (ipaFile == null) {
        print('Error: Could not find IPA file in build/ios/ipa directory');
        print('Make sure the build completed successfully');
        exit(1);
      }
      buildFilePath = ipaFile;
      print('Found IPA file: $buildFilePath');
    } else if (platform == 'android') {
      // 2. Get the Android package name from .apphost
      // final androidPackageName = await getAndroidPackageNameFromConfig();
      // if (androidPackageName == null) {
      //   print('Error: Could not find Android package name in .apphost');
      //   print(
      //     'Make sure .apphost file exists in the app directory with android_package_name field',
      //   );
      //   exit(1);
      // }
      // bundleIdentifier = androidPackageName;

      // 3. Find AAB or APK file path dynamically
      final androidFile = await findAndroidBuildFile();
      if (androidFile == null) {
        print('Error: Could not find AAB or APK file in build directory');
        print('Make sure the build completed successfully');
        exit(1);
      }
      buildFilePath = androidFile;
      print('Found Android build file: $buildFilePath');
    } else {
      throw Exception('Unknown platform: $platform');
    }

    // 4. Run the flutter_app_host upload command
    // Note: flutter_app_host command should run from package directory
    try {
      await host.do_upload(platform, buildFilePath, version, bundleIdentifier);
    } catch (e) {
      throw Exception('flutter_app_host upload failed with error $e');
    }

    print('Upload completed successfully!');
  } catch (e) {
    print('An error occurred during upload: $e');
    exit(1);
  }
}

// Function to run a shell command and print the output
Future<int> runCommand(String command, List<String> arguments) async {
  final process = await Process.start(command, arguments);
  process.stdout.transform(utf8.decoder).listen((data) {
    print(data);
  });
  process.stderr.transform(utf8.decoder).listen((data) {
    print(data);
  });
  return await process.exitCode;
}

// Function to run a shell command in the app directory
Future<int> runCommandInAppDir(String command, List<String> arguments) async {
  final process = await Process.start(
    command,
    arguments,
    workingDirectory: _appDir,
  );
  process.stdout.transform(utf8.decoder).listen((data) {
    print(data);
  });
  process.stderr.transform(utf8.decoder).listen((data) {
    print(data);
  });
  return await process.exitCode;
}

// Function to run a shell command in the package directory
Future<int> runCommandInPackageDir(
  String command,
  List<String> arguments,
) async {
  final process = await Process.start(
    command,
    arguments,
    workingDirectory: _packageDir,
  );
  process.stdout.transform(utf8.decoder).listen((data) {
    print(data);
  });
  process.stderr.transform(utf8.decoder).listen((data) {
    print(data);
  });
  return await process.exitCode;
}

// Function to get the version from pubspec.yaml
Future<String?> getVersionFromPubspec() async {
  final pubspecFile = File(_getAppPath('pubspec.yaml'));
  if (!await pubspecFile.exists()) {
    print('Error: Could not find pubspec.yaml in app directory');
    return null;
  }
  final pubspecContent = await pubspecFile.readAsString();
  final regex = RegExp(r'version:\s*(\S+)');
  final match = regex.firstMatch(pubspecContent);
  return match?.group(1);
}

// Function to get the iOS bundle identifier from the .apphost config file
Future<String?> getIosBundleIdentifierFromConfig() async {
  final configFile = File(_getAppPath('.apphost'));
  if (!await configFile.exists()) {
    print('Error: Could not find .apphost config file in app directory');
    return null;
  }
  final configContent = await configFile.readAsString();
  final config = json.decode(configContent);
  return config['ios_bundle_identifier'];
}

// Function to get the Android package name from the .apphost config file
Future<String?> getAndroidPackageNameFromConfig() async {
  final configFile = File(_getAppPath('.apphost'));
  if (!await configFile.exists()) {
    print('Error: Could not find .apphost config file in app directory');
    return null;
  }
  final configContent = await configFile.readAsString();
  final config = json.decode(configContent);
  return config['android_package_name'];
}

// Function to find the IPA file in the build directory
Future<String?> findIpaFile() async {
  final ipaDirectory = Directory(_getAppPath(p.join('build', 'ios', 'ipa')));

  if (!await ipaDirectory.exists()) {
    return null;
  }

  // List all files in the IPA directory
  final entries = ipaDirectory.listSync();

  // Find the first .ipa file
  for (final entry in entries) {
    if (entry is File && entry.path.endsWith('.ipa')) {
      return entry.path;
    }
  }

  return null;
}

// Function to find Android build file (AAB or APK) in the build directory
Future<String?> findAndroidBuildFile() async {
  // First, try to find AAB file (preferred for Play Store)
  final appbundleDirectory = Directory(
    _getAppPath(p.join('build', 'app', 'outputs', 'bundle', 'release')),
  );
  if (await appbundleDirectory.exists()) {
    final entries = appbundleDirectory.listSync();
    for (final entry in entries) {
      if (entry is File && entry.path.endsWith('.aab')) {
        return entry.path;
      }
    }
  }

  // If no AAB found, try to find APK file
  final apkDirectory = Directory(
    _getAppPath(p.join('build', 'app', 'outputs', 'flutter-apk')),
  );
  if (await apkDirectory.exists()) {
    final entries = apkDirectory.listSync();
    for (final entry in entries) {
      if (entry is File && entry.path.endsWith('.apk')) {
        return entry.path;
      }
    }
  }

  // Also check the release APK directory
  final releaseApkDirectory = Directory(
    _getAppPath(p.join('build', 'app', 'outputs', 'apk', 'release')),
  );
  if (await releaseApkDirectory.exists()) {
    final entries = releaseApkDirectory.listSync();
    for (final entry in entries) {
      if (entry is File && entry.path.endsWith('.apk')) {
        return entry.path;
      }
    }
  }

  return null;
}
