import 'dart:io';
import 'dart:convert';
import 'package:path/path.dart' as p;
import 'package:http/http.dart' as http;

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

    if (arguments.contains('--test-telegram')) {
      // Test Telegram bot notification
      await testTelegramBot();
      return;
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
  bool buildSuccess = false;
  String? errorMessage;
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
    buildSuccess = true;
  } catch (e) {
    errorMessage = e.toString();
    print('An error occurred during build: $e');
  } finally {
    // Send Telegram notification only on failure
    // Success notifications are handled by performUpload with install URL
    if (!buildSuccess) {
      await sendTelegramNotificationIfConfigured(buildSuccess, errorMessage);
      exit(1);
    }
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
      final androidPackageName = await getAndroidPackageNameFromConfig();
      if (androidPackageName == null) {
        print('Error: Could not find Android package name in .apphost');
        print(
          'Make sure .apphost file exists in the app directory with android_package_name field',
        );
        exit(1);
      }
      bundleIdentifier = androidPackageName;

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

    // 4. Get apphost configuration
    final apphostConfig = await getApphostConfig();
    if (apphostConfig == null) {
      throw Exception(
        'Error: Could not find .apphost config file in app directory',
      );
    }

    // 5. Get app name from pubspec.yaml
    final appName = await getAppNameFromPubspec();
    if (appName == null) {
      throw Exception('Error: Could not find app name in pubspec.yaml');
    }

    // 6. Upload to apphost manually
    final installUrl = await uploadToApphost(
      platform: platform,
      buildFilePath: buildFilePath,
      version: version,
      bundleIdentifier: bundleIdentifier,
      apphostConfig: apphostConfig,
    );

    print('Upload completed successfully!');
    print('Install your app from:');
    print(installUrl);
    print('');

    // 7. Send Telegram notification with install URL
    await sendTelegramNotificationWithInstallUrl(
      buildSuccess: true,
      platform: platform,
      version: version,
      appName: appName,
      installUrl: installUrl,
    );
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

// Function to get the app name from pubspec.yaml
Future<String?> getAppNameFromPubspec() async {
  final pubspecFile = File(_getAppPath('pubspec.yaml'));
  if (!await pubspecFile.exists()) {
    return null;
  }
  final pubspecContent = await pubspecFile.readAsString();
  final regex = RegExp(r'^name:\s*(\S+)', multiLine: true);
  final match = regex.firstMatch(pubspecContent);
  return match?.group(1);
}

// Function to get the apphost configuration
Future<Map<String, dynamic>?> getApphostConfig() async {
  final configFile = File(_getAppPath('.apphost'));
  if (!await configFile.exists()) {
    return null;
  }
  final configContent = await configFile.readAsString();
  try {
    final config = json.decode(configContent) as Map<String, dynamic>;
    return config;
  } catch (e) {
    print('Error parsing .apphost file: $e');
    return null;
  }
}

// Function to get the iOS bundle identifier from the .apphost config file
Future<String?> getIosBundleIdentifierFromConfig() async {
  final config = await getApphostConfig();
  if (config == null) {
    return null;
  }
  return config['ios_bundle_identifier'] as String?;
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

// Function to check if telegram_bot.env exists in app directory
Future<bool> checkTelegramBotEnvExists() async {
  final envFile = File(_getAppPath('telegram_bot.env'));
  return await envFile.exists();
}

// Function to parse telegram_bot.env file
Future<Map<String, String>?> parseTelegramBotEnv() async {
  final envFile = File(_getAppPath('telegram_bot.env'));
  if (!await envFile.exists()) {
    return null;
  }

  final content = await envFile.readAsString();
  final lines = content.split('\n');
  final Map<String, String> env = {};

  for (final line in lines) {
    final trimmedLine = line.trim();
    if (trimmedLine.isEmpty || trimmedLine.startsWith('#')) {
      continue;
    }

    final equalIndex = trimmedLine.indexOf('=');
    if (equalIndex == -1) {
      continue;
    }

    final key = trimmedLine.substring(0, equalIndex).trim();
    final value = trimmedLine.substring(equalIndex + 1).trim();
    env[key] = value;
  }

  // Check if all required keys are present
  if (env.containsKey('TELEGRAM_BOT_TOKEN') &&
      env.containsKey('TELEGRAM_CHAT_ID')) {
    return env;
  }

  return null;
}

// Function to send Telegram notification
Future<void> sendTelegramNotification(
  String botToken,
  String chatId,
  String message, {
  String? topicId,
}) async {
  try {
    final url = Uri.parse('https://api.telegram.org/bot$botToken/sendMessage');

    final Map<String, dynamic> body = {
      'chat_id': chatId,
      'text': message,
      'parse_mode': 'HTML',
    };

    if (topicId != null && topicId.isNotEmpty) {
      body['message_thread_id'] = topicId;
    }

    final response = await http.post(
      url,
      headers: {'Content-Type': 'application/json'},
      body: json.encode(body),
    );

    if (response.statusCode == 200) {
      print('Telegram notification sent successfully');
    } else {
      print(
        'Failed to send Telegram notification: ${response.statusCode} - ${response.body}, chatID: $chatId, topicID: $topicId',
      );
    }
  } catch (e) {
    print(
      'Error sending Telegram notification: $e, chatID: $chatId, topicID: $topicId',
    );
  }
}

// Function to send Telegram notification if configured
Future<void> sendTelegramNotificationIfConfigured(
  bool buildSuccess,
  String? errorMessage,
) async {
  if (!await checkTelegramBotEnvExists()) {
    return;
  }

  final env = await parseTelegramBotEnv();
  if (env == null) {
    print('Warning: telegram_bot.env exists but is missing required fields');
    return;
  }

  final botToken = env['TELEGRAM_BOT_TOKEN']!;
  final chatId = env['TELEGRAM_CHAT_ID']!;
  final topicId = env['TELEGRAM_TOPIC_ID'];

  // Get version and platform info for the message
  final version = await getVersionFromPubspec() ?? 'unknown';
  final platform = _platform ?? 'unknown';

  String message;
  if (buildSuccess) {
    message =
        '''
✅ <b>Build Completed Successfully</b>

Platform: $platform
Version: $version
Status: Build and upload completed successfully
''';
  } else {
    message =
        '''
❌ <b>Build Failed</b>

Platform: $platform
Version: $version
Error: ${errorMessage ?? 'Unknown error'}
''';
  }

  await sendTelegramNotification(botToken, chatId, message, topicId: topicId);
}

// Function to test Telegram bot notification
Future<void> testTelegramBot() async {
  print('Testing Telegram bot notification...');
  print('');

  // Check if telegram_bot.env exists
  if (!await checkTelegramBotEnvExists()) {
    print('Error: telegram_bot.env file not found in app directory');
    print('Expected location: ${_getAppPath('telegram_bot.env')}');
    print('');
    print('Please create telegram_bot.env with the following format:');
    print('TELEGRAM_BOT_TOKEN=your_bot_token');
    print('TELEGRAM_CHAT_ID=your_chat_id');
    print('TELEGRAM_TOPIC_ID=your_topic_id (optional)');
    exit(1);
  }

  print('✓ Found telegram_bot.env file');

  // Parse the env file
  final env = await parseTelegramBotEnv();
  if (env == null) {
    print('Error: telegram_bot.env exists but is missing required fields');
    print('Required fields: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID');
    print('Optional fields: TELEGRAM_TOPIC_ID');
    exit(1);
  }

  final botToken = env['TELEGRAM_BOT_TOKEN']!;
  final chatId = env['TELEGRAM_CHAT_ID']!;
  final topicId = env['TELEGRAM_TOPIC_ID'];

  print('✓ Parsed telegram_bot.env successfully');
  print('  Bot Token: ${botToken.substring(0, 10)}...');
  print('  Chat ID: $chatId');
  if (topicId != null && topicId.isNotEmpty) {
    print('  Topic ID: $topicId');
  } else {
    print('  Topic ID: (not set)');
  }
  print('');

  // Send test message
  final testMessage =
      '''
🧪 <b>Telegram Bot Test</b>

This is a test message from the build script.

Timestamp: ${DateTime.now().toIso8601String()}
App Directory: ${p.absolute(_appDir!)}

If you received this message, your Telegram bot configuration is working correctly! ✅
''';

  print('Sending test message...');
  await sendTelegramNotification(
    botToken,
    chatId,
    testMessage,
    topicId: topicId,
  );
  print('');
  print(
    'Test completed! Check your Telegram chat to verify the message was received.',
  );
}

// Function to upload to apphost manually
Future<String> uploadToApphost({
  required String platform,
  required String buildFilePath,
  required String version,
  required String bundleIdentifier,
  required Map<String, dynamic> apphostConfig,
}) async {
  final userId = apphostConfig['user_id'] as String?;
  final appId = apphostConfig['app_id'] as String?;
  final key = apphostConfig['key'] as String?;

  if (userId == null || appId == null || key == null) {
    throw Exception(
      'Error: Missing required fields in .apphost (user_id, app_id, key)',
    );
  }

  // Fetch upload URL
  print('Fetching upload URL...');
  final uploadUrlParams = {
    'user_id': userId,
    'app_id': appId,
    'key': key,
    'platform': platform,
    'version': version,
    if (platform == 'ios')
      'ios_bundle_identifier': bundleIdentifier
    else if (platform == 'android')
      'android_package_name': bundleIdentifier,
  };

  final uploadUrlUri = Uri.parse('https://appho.st/api/get_upload_url').replace(
    queryParameters: uploadUrlParams.map((k, v) => MapEntry(k, v.toString())),
  );

  final uploadUrlResponse = await http.get(uploadUrlUri);
  if (uploadUrlResponse.statusCode != 200) {
    throw Exception(
      'Error fetching upload URL: ${uploadUrlResponse.statusCode} - ${uploadUrlResponse.body}',
    );
  }

  final uploadUrl = uploadUrlResponse.body.trim();
  if (!uploadUrl.startsWith('https://')) {
    throw Exception('Error fetching upload URL: $uploadUrl');
  }

  // Upload file
  print('Uploading file...');
  final buildFile = File(buildFilePath);
  if (!await buildFile.exists()) {
    throw Exception('Build file not found: $buildFilePath');
  }

  final fileBytes = await buildFile.readAsBytes();
  final fileSize = fileBytes.length;

  final uploadResponse = await http.put(
    Uri.parse(uploadUrl),
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileSize.toString(),
    },
    body: fileBytes,
  );

  if (uploadResponse.statusCode != 200) {
    throw Exception(
      'Error uploading file: ${uploadResponse.statusCode} - ${uploadResponse.body}',
    );
  }

  print('File uploaded successfully');

  // Get install URL
  print('Fetching install URL...');
  final installUrlParams = {'u': userId, 'a': appId, 'platform': platform};

  final installUrlUri = Uri.parse('https://appho.st/api/get_current_version/')
      .replace(
        queryParameters: installUrlParams.map(
          (k, v) => MapEntry(k, v.toString()),
        ),
      );

  final installUrlResponse = await http.get(installUrlUri);
  if (installUrlResponse.statusCode != 200) {
    throw Exception(
      'Error fetching install URL: ${installUrlResponse.statusCode} - ${installUrlResponse.body}',
    );
  }

  try {
    final installUrlJson = json.decode(installUrlResponse.body) as Map;
    final installUrl = installUrlJson['url'] as String?;
    if (installUrl == null) {
      throw Exception('Install URL not found in response');
    }
    return installUrl;
  } catch (e) {
    // Fallback: try to extract URL from response if JSON parsing fails
    final urlMatch = RegExp(
      r'"url"\s*:\s*"([^"]+)"',
    ).firstMatch(installUrlResponse.body);
    if (urlMatch != null) {
      return urlMatch.group(1)!;
    }
    throw Exception('Could not parse install URL from response: $e');
  }
}

// Function to send Telegram notification with install URL
Future<void> sendTelegramNotificationWithInstallUrl({
  required bool buildSuccess,
  required String platform,
  required String version,
  required String appName,
  required String installUrl,
}) async {
  if (!await checkTelegramBotEnvExists()) {
    return;
  }

  final env = await parseTelegramBotEnv();
  if (env == null) {
    print('Warning: telegram_bot.env exists but is missing required fields');
    return;
  }

  final botToken = env['TELEGRAM_BOT_TOKEN']!;
  final chatId = env['TELEGRAM_CHAT_ID']!;
  final topicId = env['TELEGRAM_TOPIC_ID'];

  String message;
  if (buildSuccess) {
    message =
        '''
✅ <b>Build & Upload Completed Successfully</b>

App: $appName
Platform: $platform
Version: $version

📱 <b>Install URL:</b>
$installUrl
''';
  } else {
    message =
        '''
❌ <b>Build Failed</b>

App: $appName
Platform: $platform
Version: $version
''';
  }

  await sendTelegramNotification(botToken, chatId, message, topicId: topicId);
}
