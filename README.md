# tunai-build-script

Node.js CLI for Flutter **iOS/Android build + distribution upload** ([appho.st](https://appho.st/) or [Loadly](https://loadly.io/)), optional **Telegram** notifications, **version bump** (`--bump-version`), **macOS TestFlight** (`--platform macos`, via the bundled shell script), and **changelog generation** (`--generate-changelog`, engineering + tester markdown from git).

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

# Changelog (git on PATH; --generate-changelog must be first)
tunai-build-script --generate-changelog
tunai-build-script --generate-changelog v1.0.0 HEAD
tunai-build-script --generate-changelog --from v1.0.0 --to HEAD -o CHANGELOG.release.md
tunai-build-script --generate-changelog --git-root . --no-tester
tunai-build-script --generate-changelog --no-fetch-github-pr v1.0.0 HEAD
```

Run **`tunai-build-script -help`** for the full option list.

### Changelog generation (`--generate-changelog`)

Use **`tunai-build-script --generate-changelog`** as the **first** argument; everything after it is passed to the bundled generator (same as `node node/lib/generate-changelog.mjs` in this repo).

| Output | Default path | Content |
|--------|----------------|--------|
| Engineering | `changelog.md` | Main repo + submodule commits (`--output` / `-o` to override) |
| Tester | `changelog_tester.md` | Same `###` sections from **squash/merge commit bodies**; optional GitHub PR fetch (see below) (`--tester-output`; `--no-tester` to skip) |

Discovery: walks up for **`pubspec.yaml`** unless you pass **`--project-root`** or **`--git-root`**. Range: **`--from`** / **`--to`** or two positionals; non-interactive defaults: from = latest tag or `HEAD`, to = `HEAD`. **`--strict`** fails if the main repo `git log` errors.

**PR descriptions when the squash body is empty:** If the commit **subject** includes **`(#123)`** but the git body has no tester sections, the generator loads the PR via **[GitHub CLI](https://cli.github.com/)** (`gh pr view`) when **`gh auth login`** has been run. If `gh` is missing or not authenticated, it **prints a warning** and **does not fetch** PRs. Use **`--no-fetch-github-pr`** to skip PR fetch entirely. Each repo’s **`origin`** should be a `github.com` URL (submodules: that submodule’s remote). Use **`--github-repo owner/repo`** only for the **main** app when `origin` is not standard GitHub. For GitHub Enterprise with `gh`, set **`GH_HOST`** as usual.

The tester report splits **“PR in subject but nothing loaded”** vs **“no `(#number)` in subject”** so lists are not mislabeled.

Squash/merge bodies (or PR descriptions when fetched) should include:

```text
### User Visible Changes
…
### Risk Level
…
```

**macOS TestFlight** uses `scripts/upload_macos_testflight.sh` (Xcode, CocoaPods). Prefer **`macos_testflight`** in `tunai_build_script_config.json` for API key JSON or legacy `ASC_*` paths; the CLI exports them for the script. See script header comments for env-only setup.

**Export fails: “No signing certificate Mac App Distribution found”** — The archive step does not need that cert; **export** does. Use **`method` `app-store-connect`** in `macos/ExportOptions.plist` (not deprecated `app-store`). In Xcode open **`macos/Runner.xcworkspace`**, select the **Runner** target, **Signing & Capabilities**, set the same **Team** as `teamID` in the plist, enable **Automatically manage signing** for **Release**. If Keychain still has no distribution cert: **Xcode → Settings → Accounts → Manage Certificates…** add **Apple Distribution** (or **Mac App Distribution**). The script passes **`-allowProvisioningUpdates`** so Xcode can refresh provisioning when an Apple ID is signed in.
