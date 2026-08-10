# tunai-build-script

Node.js CLI for Flutter **iOS/Android build + distribution upload** ([appho.st](https://appho.st/), [Buildport](https://support.tunai.io/buildport/), or [Loadly](https://loadly.io/)), optional **Telegram** notifications (including Android direct APK delivery), production-configured iOS **release candidates** (`--release-candidate ios`), **version bump** (`--bump-version`), **release prep** (`--prepare-release`: bump, changelog, commit, push, tag), **macOS TestFlight** (`--platform macos`, via the bundled shell script), and **changelog generation** (`--generate-changelog`, engineering log + tester doc listing **PR title + description** per `(#N)` commit, grouped by app vs submodules).

Configuration lives in a single file at the **Flutter app root**: `tunai_build_script_config.json`, or pass **`--config <path>`** to use a file outside the repo (e.g. gitignored credentials per branch).

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
| `upload.providers` | Optional per-platform provider map, e.g. `{ "ios": "apphost", "android": "telegram_apk" }` |
| `upload.provider` | Legacy/default provider fallback: `"apphost"` (default), `"buildport"`, `"loadly"`, or `"telegram_apk"` |
| `prepare_release` | Optional defaults for `--prepare-release`, including `tag_prefix` (`"release"` → `release-v1.0.1+11`, `""` → `v1.0.1+11`) |
| `release_candidate` | Optional `tag_prefix` for `--release-candidate` (default: `release-candidate`) |
| `channel.test` | Required for `--test-release`: test identifiers plus `env_overrides.TestVersion: "true"`; optional `env_file` |
| `channel.prod` | Required for `--release-candidate`: production `ios_bundle_id`, `ios_display_name`, `ios_export_options_plist`, and `env_overrides.TestVersion: "false"`; optional `env_file` |
| `apphost` | Required when the selected provider is `apphost`: `user_id`, `app_id`, `key`, `ios_bundle_identifier`, `android_package_name` |
| `buildport` | Required when the selected provider is `buildport`: `api_token` or env `BUILDPORT_API_TOKEN`. Optional: `app_group` (defaults to pubspec `name`), `timeout_seconds` (60–1800, default 600), `changes_path` (tester changelog to derive the change checklist from, default `changelog_tester.md`). Other upload metadata is derived from app info: pubspec version, platform display name, and pubspec description |
| `loadly` | Required when the selected provider is `loadly`: `api_key` from [Loadly API](https://loadly.io/doc/view/api). Optional: `build_update_description`, `build_password`, `build_install_type`, `build_channel_shortcut`, `timeout_seconds` (60–1800, default 600) |
| `telegram` | Optional for notifications; required when provider is `telegram_apk`. `bot_token`, `chat_id`, optional `topic_id`. Optional `changelog_summary` can use the signed-in Claude CLI to send an AI summary before the changelog document. Use `${ENV_VAR}` in strings to pull secrets from the environment |
| `ios.export_options_plist` | Relative path to the plist passed to `flutter build ipa` (default `ios/ExportOptions.plist`) |
| `upload.changelog_path` | Optional relative path; file is sent via Telegram after a successful upload |
| `macos_testflight` | For `--platform macos`: `scheme`, `export_plist`, and **`app_store_key_json_path`** (relative or absolute) pointing at JSON: `key_id`, `issuer_id`, `key` (PEM string), optional `duration`, `in_house`. The CLI writes a temp `.p8` for `altool`. `${ENV}` works inside that JSON. **Legacy:** `api_key_id`, `api_issuer_id`, `api_private_key_path` (used only if `app_store_key_json_path` is omitted) |

Plist templates: `example/example_export_options_ios.plist` (IPA export), `example/example_export_options_macos.plist` (Mac App Store / TestFlight). App Store Connect API key JSON: `example/app_store_connect_api_key.example.json`.

Keep channel switches such as `TestVersion` out of `.env.tunai.defaults`. The test and production channel configs must set them explicitly so a shared default cannot silently override the selected release channel.

`telegram_apk` is Android-only and sends the built APK file directly to Telegram as a document.

To summarize `upload.changelog_path` before its Telegram document is sent, enable `telegram.changelog_summary` as shown in the example config. The `claude_cli` provider runs `claude -p --model haiku` with tools and session persistence disabled. It removes Anthropic API environment variables from the child process so the Claude CLI uses its signed-in subscription. Summary generation or delivery failure only logs a warning; it never blocks the original changelog document or turns a successful release into a failed one. Use `--test-changelog-summary changelog_tester.md --platform ios` to generate and send only the summary.

`buildport` uploads the generated `.apk` or `.ipa` to `https://support.tunai.io/buildport/api/releases` as multipart field `apps` and returns the tester share URL from the API response. It sends `app_group` from `buildport.app_group` when configured, otherwise pubspec `name`; `release_version` from pubspec `version`; `title` from app display name + version; and `notes` from pubspec `description`. When a tester changelog exists (`buildport.changes_path`, default `changelog_tester.md`, as written by `--generate-changelog`/`--prepare-release`), its PR entries are also sent as a `changes` JSON array (`text`, `pr_number`, `pr_url` from each repo's github.com origin, `module` from the submodule name, and `category` — feature/fix/improvement/internal — inferred from the PR title) so Buildport shows a per-version tester checklist grouped by module. Only the newest `## Release` section is read; if the file is missing, the upload proceeds without changes.

## Commands

```bash
# iOS / Android — from app repo (walks up to find tunai_build_script_config.json)
tunai-build-script
tunai-build-script --config ~/secrets/staging.json --project-root .
tunai-build-script --platform ios --no-update
tunai-build-script --upload
tunai-build-script --upload-changelog CHANGELOG.md
tunai-build-script --test-telegram
tunai-build-script --test-upload-file notes.md
tunai-build-script --test-changelog-summary changelog_tester.md --platform ios

# Version bump
tunai-build-script --bump-version patch
tunai-build-script --bump-version manual 1.2.3+5 --project-root /path/to/app
tunai-build-script --bump-version major --yes

# Prepare release (bump + changelog + git commit/push + tag; config optional)
tunai-build-script --prepare-release patch
tunai-build-script --prepare-release build --project-root /path/to/app
tunai-build-script --prepare-release patch --tag-prefix release --changelog-from v1.0.0
tunai-build-script --prepare-release build --tag-prefix "" --changelog-from v1.0.0+10

# Production-configured iOS candidate for final testing on Buildport
tunai-build-script --release-candidate ios --dry-run
tunai-build-script --release-candidate ios

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

### Release candidate (`--release-candidate ios`)

Builds a final-testing IPA with the production runtime channel and production bundle identifier, signs it for ad-hoc installation, verifies the completed IPA, and uploads it to Buildport. It intentionally does not require a particular branch or approved SHA.

The command requires a clean git tree because it reuses `--prepare-release build`: it bumps the build number, writes scoped changelogs, commits, pushes, creates an annotated RC tag, and pushes that tag before building. Use `--dry-run` to validate configuration and preview these steps without writing channel files or changing git.

Required configuration:

```json
{
  "release_candidate": {
    "tag_prefix": "my-app-rc"
  },
  "channel": {
    "prod": {
      "ios_bundle_id": "com.example.app",
      "ios_display_name": "Example",
      "ios_export_options_plist": "ios/ExportOptions.prod-adhoc.plist",
      "env_overrides": {
        "TestVersion": "false"
      }
    }
  },
  "buildport": {
    "api_token": "${BUILDPORT_API_TOKEN}",
    "app_group": "Example"
  }
}
```

Before upload, the CLI opens the generated IPA and requires both:

- `CFBundleIdentifier` exactly matches `channel.prod.ios_bundle_id`.
- `CFBundleDisplayName` exactly matches `channel.prod.ios_display_name`.
- The packaged Flutter asset `.env` contains `TestVersion=false`.
- The packaged `.env.tunai.defaults`, when present, does not define `TestVersion`.

The resulting Buildport IPA is ad-hoc signed for registered tester devices. It is not the App Store binary; build the same approved commit later with App Store signing for TestFlight/App Store Connect.

### Prepare release (`--prepare-release`)

Chains **version bump → changelog → git commit → push → annotated tag → push tag** in one command. Does **not** require `tunai_build_script_config.json`, but uses `prepare_release.tag_prefix` when config is present. Requires **`pubspec.yaml`**, **git** on `PATH`, and a **clean working tree** (commit or stash other changes first).

| Step | What happens |
|------|----------------|
| 1 | Bump `major` \| `minor` \| `patch` \| `build` \| `manual` (same as `--bump-version`; `manual` needs a version, e.g. `1.2.3+5`) |
| 2 | Write **`changelog.md`** and **`changelog_tester.md`** (same content as `--generate-changelog` defaults) |
| 3 | Commit version files + changelogs (`chore(release): v{version}`) |
| 4 | `git push` |
| 5 | Create annotated tag from pubspec version |
| 6 | `git push origin <tag>` |

**Bump behaviour:** For `major` / `minor` / `patch`, the **build number is always incremented** (equivalent to `--yes` on `--bump-version`). `build` only bumps the build number.

**Git tag naming:** Version from `pubspec.yaml` is tagged as `v1.0.1+11` by default. Optional prefix: `prepare_release.tag_prefix: "release"` or `--tag-prefix release` → `release-v1.0.1+11`. Set the config value or CLI value to `""`, or omit it, for no prefix.

**Changelog FROM default:** If no tag prefix is configured, the default is the latest reachable tag. If a prefix is configured, the CLI first looks for the latest reachable matching tag (`release` → `release-v*`) and falls back to the latest reachable tag when no matching tag exists.

**Interactive (TTY):** Prompts for changelog **from** / **to** revisions using the prefix-aware default above. It does not prompt for tag prefix; configure `prepare_release.tag_prefix` or pass `--tag-prefix` when you need one.

**Non-interactive:** Provide tag prefix with either `prepare_release.tag_prefix` in config or **`--tag-prefix`** only when you need one. **`--changelog-from`** can be omitted and will use the prefix-aware default above. **`--changelog-to`** defaults to `HEAD`.

```bash
# Interactive
tunai-build-script --prepare-release patch

# CI / script
tunai-build-script --prepare-release patch \
  --changelog-from v1.0.0 \
  --tag-prefix release
```

**Rollback:** On failure after the bump starts, the CLI restores snapshotted files, deletes a local tag if one was created, and `git reset --hard` to the pre-run `HEAD` if a commit was made. If **`git push`** already succeeded, you may need to fix the remote manually.

Cannot be combined with `--platform`, `--upload`, or `--bump-version`.

### Changelog generation (`--generate-changelog`)

Use **`tunai-build-script --generate-changelog`** as the **first** argument; everything after it is passed to the bundled generator (same as `node node/lib/generate-changelog.mjs` in this repo).

| Output | Default path | Content |
|--------|----------------|--------|
| Engineering | `changelog.md` | Main repo + submodule commits (`--output` / `-o` to override) |
| Tester | `changelog_tester.md` | **PRs only**, grouped under **Main app** and each **Submodule**: **PR title + description** from `gh pr view` when available; only commits whose subject includes `(#N)` (`--tester-output`; `--no-tester` to skip) |

Discovery: walks up for **`pubspec.yaml`** unless you pass **`--project-root`** or **`--git-root`**. Range: **`--from`** / **`--to`** or two positionals; non-interactive defaults: from = latest tag or `HEAD`, to = `HEAD`. **`--strict`** fails if the main repo `git log` errors.

**Tester PR list:** Entries are **`#### PR #N — <title>`** plus the PR body (markdown as returned by GitHub). PR metadata is **prefetched in parallel** (bounded concurrency) so large releases are much faster than one `gh pr view` at a time. If **`gh auth login`** is not set up, titles/descriptions fall back to the **commit subject** (with `(#N)` stripped) and **commit body**. Use **`--no-fetch-github-pr`** to force that fallback only. Each repo’s **`origin`** should be a `github.com` URL (submodules use that submodule’s remote). Use **`--github-repo owner/repo`** for the **main** app when `origin` is not standard GitHub. For GitHub Enterprise with `gh`, set **`GH_HOST`** as usual.

Commits **without** `(#N)` in the subject do not appear in the tester file (engineering `changelog.md` still lists every commit).

**macOS TestFlight** uses `scripts/upload_macos_testflight.sh` (Xcode, CocoaPods). Prefer **`macos_testflight`** in `tunai_build_script_config.json` for API key JSON or legacy `ASC_*` paths; the CLI exports them for the script. See script header comments for env-only setup.

**Export fails: “No signing certificate Mac App Distribution found”** — The archive step does not need that cert; **export** does. Use **`method` `app-store-connect`** in `macos/ExportOptions.plist` (not deprecated `app-store`). In Xcode open **`macos/Runner.xcworkspace`**, select the **Runner** target, **Signing & Capabilities**, set the same **Team** as `teamID` in the plist, enable **Automatically manage signing** for **Release**. If Keychain still has no distribution cert: **Xcode → Settings → Accounts → Manage Certificates…** add **Apple Distribution** (or **Mac App Distribution**). The script passes **`-allowProvisioningUpdates`** so Xcode can refresh provisioning when an Apple ID is signed in.
