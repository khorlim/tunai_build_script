import 'dart:io';
import 'package:path/path.dart' as p;

/// Runs [scripts/upload_macos_testflight.sh] from this package.
///
/// From your Flutter app root (after adding this package):
///   dart run upload_macos_testflight
///   dart run upload_macos_testflight -- --build-only
Future<void> main(List<String> args) async {
  final scriptFile = File.fromUri(Platform.script);
  final packageRoot = p.normalize(p.join(scriptFile.parent.path, '..'));
  final shellScript = p.join(packageRoot, 'scripts', 'upload_macos_testflight.sh');

  if (!File(shellScript).existsSync()) {
    stderr.writeln('Missing script: $shellScript');
    exit(1);
  }

  final proc = await Process.start(
    'bash',
    [shellScript, ...args],
    workingDirectory: Directory.current.path,
    environment: Platform.environment,
    mode: ProcessStartMode.inheritStdio,
  );
  exit(await proc.exitCode);
}
