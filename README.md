# tunai-build-script

Node.js CLI for Flutter **iOS/Android build + apphost upload**, optional **Telegram** notifications, **version bump** (`--bump-version`), and **macOS TestFlight** (`--platform macos`, via the bundled shell script).

Configuration lives in a single file at the **Flutter app root**: `tunai_build_script_config.json`.

## Install from Git

Repository: [github.com/khorlim/tunai_build_script](https://github.com/khorlim/tunai_build_script)

In your app or globally:

```bash
npm install -g git+https://github.com/khorlim/tunai_build_script.git
```

Or add a dev dependency and use `npx`:

```bash
npm install -D git+https://github.com/khorlim/tunai_build_script.git
npx tunai-build-script -help
```

Update after install
```bash
npm update tunai-build-script
```

After install, the **`tunai-build-script`** command is on your `PATH` (global) or in `node_modules/.bin` (local).

## Project config

Copy `example/tunai_build_script_config.example.json` to your Flutter project root as **`tunai_build_script_config.json`**.

| Section | Purpose |
|--------|---------|
| `apphost` | `user_id`, `app_id`, `key`, `ios_bundle_identifier`, `android_package_name` (same as the former `.apphost` JSON) |
| `telegram` | Optional. `bot_token`, `chat_id`, optional `topic_id`. Use `${ENV_VAR}` in strings to pull secrets from the environment |
| `ios.export_options_plist` | Relative path to the plist passed to `flutter build ipa` (default `ios/ExportOptions.plist`) |
| `upload.changelog_path` | Optional relative path; file is sent via Telegram after a successful upload |
| `macos_testflight` | Optional `scheme` and `export_plist` for `--platform macos` (sets `SCHEME` / `EXPORT_PLIST` for the shell script) |

Plist templates: `example/example_export_options_ios.plist` (IPA export), `example/example_export_options_macos.plist` (Mac App Store / TestFlight).

## Commands

```bash
# iOS / Android — from app repo (walks up to find tunai_build_script_config.json)
tunai-build-script
tunai-build-script --platform ios --no-update
tunai-build-script --upload
tunai-build-script --upload-changelog CHANGELOG.md
tunai-build-script --test-telegram
tunai-build-script --test-upload-file notes.md

# Version bump
tunai-build-script --bump-version patch
tunai-build-script --bump-version manual 1.2.3+5 --project-root /path/to/app
tunai-build-script --bump-version major --yes

# macOS TestFlight
tunai-build-script --platform macos
tunai-build-script --platform macos --build-only
tunai-build-script --platform macos --repo-update --project-root /path/to/app
```

Run **`tunai-build-script -help`** for the full option list.

**macOS TestFlight** uses `scripts/upload_macos_testflight.sh` (Xcode, CocoaPods, `ASC_*` env vars). See comments in that script for API key setup.
