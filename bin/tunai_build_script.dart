import 'dart:io';
import 'dart:convert';
import 'package:path/path.dart' as p;

void main(List<String> arguments) async {
  try {
    if (arguments.contains('--upload')) {
      // Perform only upload if '--upload' is passed
      await performUpload();
    } else {
      bool update = arguments.contains('--update');
      await performBuild(update: update);
    }
  } catch (e) {
    print('An error occurred: $e');
  }
}

Future<void> performBuild({bool update = true}) async {
  try {
    print('Starting the build process...');

    if (update) {
      await runCommand('git', ['pull']);
      await runCommand('git', ['submodule', 'update']);
      await runCommand('flutter', ['pub', 'get']);
    }

    await runCommand('flutter', [
      'build',
      'ipa',
      '--export-options-plist',
      'ios/ExportOptions.plist',
    ]);

    await performUpload();

    print('Build and upload process completed successfully!');
  } catch (e) {
    print('An error occurred during build: $e');
  }
}

Future<void> performUpload() async {
  try {
    print('Starting the upload process...');

    // 1. Get the version from pubspec.yaml
    final version = await getVersionFromPubspec();
    if (version == null) {
      print('Error: Could not find version in pubspec.yaml');
      return;
    }

    // 2. Get the iOS bundle identifier from .apphost
    final iosBundleIdentifier = await getIosBundleIdentifierFromConfig();
    if (iosBundleIdentifier == null) {
      print('Error: Could not find iOS bundle identifier in .apphost');
      return;
    }

    // 3. Define IPA file path
    final ipaFilePath = p.join('build', 'ios', 'ipa', 'TunaiPro.ipa');

    // 4. Run the flutter_app_host upload command
    await runCommand('flutter', [
      'packages',
      'pub',
      'run',
      'flutter_app_host',
      'ipa',
      version,
      ipaFilePath,
      iosBundleIdentifier,
    ]);

    print('Upload completed successfully!');
  } catch (e) {
    print('An error occurred during upload: $e');
  }
}

// Function to run a shell command and print the output
Future<void> runCommand(String command, List<String> arguments) async {
  final process = await Process.start(command, arguments);
  process.stdout.transform(utf8.decoder).listen((data) {
    print(data);
  });
  process.stderr.transform(utf8.decoder).listen((data) {
    print(data);
  });
  await process.exitCode;
}

// Function to get the version from pubspec.yaml
Future<String?> getVersionFromPubspec() async {
  final pubspecFile = File('pubspec.yaml');
  if (!await pubspecFile.exists()) {
    print('Error: Could not find pubspec.yaml');
    return null;
  }
  final pubspecContent = await pubspecFile.readAsString();
  final regex = RegExp(r'version:\s*(\S+)');
  final match = regex.firstMatch(pubspecContent);
  return match?.group(1);
}

// Function to get the iOS bundle identifier from the .apphost config file
Future<String?> getIosBundleIdentifierFromConfig() async {
  final configFile = File('.apphost');
  if (!await configFile.exists()) {
    print('Error: Could not find .apphost config file');
    return null;
  }
  final configContent = await configFile.readAsString();
  final config = json.decode(configContent);
  return config['ios_bundle_identifier'];
}
