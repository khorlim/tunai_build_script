# tunai-build-script

Node.js CLI for Flutter **iOS/Android build + distribution upload** ([appho.st](https://appho.st/) or [Loadly](https://loadly.io/)), optional **Telegram** notifications, **version bump** (`--bump-version`), and **macOS TestFlight** (`--platform macos`, via the bundled shell script).

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


After install, the **`tunai-build-script`** command is on your `PATH` (global) or in `node_modules/.bin` (local).

## Project config

Copy `example/tunai_build_script_config.example.json` to your Flutter project root as **`tunai_build_script_config.json`**.

| Section | Purpose |
|--------|---------|
| `upload.provider` | `"apphost"` (default) or `"loadly"` |
| `apphost` | Required when `upload.provider` is `apphost`: `user_id`, `app_id`, `key`, `ios_bundle_identifier`, `android_package_name` |
| `loadly` | Required when `upload.provider` is `loadly`: `api_key` from [Loadly API](https://loadly.io/doc/view/api). Optional: `build_update_description`, `build_password`, `build_install_type`, `build_channel_shortcut`, `timeout_seconds` (60–1800, default 600) |
| `telegram` | Optional. `bot_token`, `chat_id`, optional `topic_id`. Use `${ENV_VAR}` in strings to pull secrets from the environment |
| `ios.export_options_plist` | Relative path to the plist passed to `flutter build ipa` (default `ios/ExportOptions.plist`) |
| `upload.changelog_path` | Optional relative path; file is sent via Telegram after a successful upload |
| `macos_testflight` | For `--platform macos`: `scheme`, `export_plist`, and **`app_store_key_json_path`** (relative or absolute) pointing at JSON: `key_id`, `issuer_id`, `key` (PEM string), optional `duration`, `in_house`. The CLI writes a temp `.p8` for `altool`. `${ENV}` works inside that JSON. **Legacy:** `api_key_id`, `api_issuer_id`, `api_private_key_path` (used only if `app_store_key_json_path` is omitted) |

Plist templates: `example/example_export_options_ios.plist` (IPA export), `example/example_export_options_macos.plist` (Mac App Store / TestFlight). App Store Connect API key JSON: `example/app_store_connect_api_key.example.json`.

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

**macOS TestFlight** uses `scripts/upload_macos_testflight.sh` (Xcode, CocoaPods). Prefer **`macos_testflight`** in `tunai_build_script_config.json` for API key JSON or legacy `ASC_*` paths; the CLI exports them for the script. See script header comments for env-only setup.

**Export fails: “No signing certificate Mac App Distribution found”** — The archive step does not need that cert; **export** does. Use **`method` `app-store-connect`** in `macos/ExportOptions.plist` (not deprecated `app-store`). In Xcode open **`macos/Runner.xcworkspace`**, select the **Runner** target, **Signing & Capabilities**, set the same **Team** as `teamID` in the plist, enable **Automatically manage signing** for **Release**. If Keychain still has no distribution cert: **Xcode → Settings → Accounts → Manage Certificates…** add **Apple Distribution** (or **Mac App Distribution**). The script passes **`-allowProvisioningUpdates`** so Xcode can refresh provisioning when an Apple ID is signed in.
