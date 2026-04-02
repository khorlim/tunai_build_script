#!/usr/bin/env bash
# Upload a Flutter macOS build to TestFlight / App Store Connect.
#
# Prerequisites:
#   - Xcode with valid Apple Developer account (Signing: Automatic in Xcode works).
#   - CocoaPods (pod).
#   - Flutter on PATH.
#   - App Store Connect API key (.p8) for CLI upload; or use --build-only and upload via Transporter.
#
# Usage:
#   ./scripts/upload_macos_testflight.sh [APP_DIR]
#   APP_DIR defaults to the current working directory.
#
# Before archive: runs `pod install` in APP_DIR/macos, then `flutter pub get`.
#
# Required files:
#   macos/ExportOptions.plist — use example/example_export_options_macos.plist as a template
#     (method app-store-connect recommended; signingStyle automatic, your teamID).
#   tunai-build-script --platform macos reads tunai_build_script_config.json → macos_testflight and
#     exports SCHEME, EXPORT_PLIST, ASC_API_KEY_ID, ASC_API_ISSUER_ID, ASC_API_KEY_PATH.
#
# Upload auth (config preferred when using tunai-build-script):
#   In tunai_build_script_config.json → macos_testflight:
#     app_store_key_json_path — JSON with key_id, issuer_id, key (PEM), optional duration, in_house
#       (see example/app_store_connect_api_key.example.json). ${ENV} substitution applies in that file.
#   Or legacy fields: api_key_id, api_issuer_id, api_private_key_path (.p8 path).
#
# Or set environment variables yourself:
#   export ASC_API_KEY_ID=...
#   export ASC_API_ISSUER_ID=...
#   export API_PRIVATE_KEYS_DIR=/path/to/dir   # dir contains AuthKey_<KEY_ID>.p8
#   # or:
#   export ASC_API_KEY_PATH=/path/to/AuthKey_XXXXX.p8
#
# Options:
#   --build-only     Archive and export only; do not upload.
#   --repo-update    Pass --repo-update to pod install.
#   -h, --help       Show this help.

set -euo pipefail

BUILD_ONLY=false
# Bash 5.2 + set -u treats empty arrays as unbound; use a flag instead of POD_REPO_UPDATE=( ).
POD_INSTALL_REPO_UPDATE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only)
      BUILD_ONLY=true
      shift
      ;;
    --repo-update)
      POD_INSTALL_REPO_UPDATE=true
      shift
      ;;
    -h|--help)
      sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

APP_DIR="${1:-${APP_DIR:-$PWD}}"
APP_DIR="$(cd "$APP_DIR" && pwd)"
MACOS_DIR="$APP_DIR/macos"
WORKSPACE="$MACOS_DIR/Runner.xcworkspace"
SCHEME="${SCHEME:-Runner}"
EXPORT_PLIST="${EXPORT_PLIST:-$MACOS_DIR/ExportOptions.plist}"
BUILD_ROOT="$APP_DIR/build/macos_ci"
ARCHIVE_PATH="$BUILD_ROOT/Runner.xcarchive"
EXPORT_DIR="$BUILD_ROOT/export"

if [[ ! -d "$MACOS_DIR" ]]; then
  echo "Error: macos folder not found: $MACOS_DIR" >&2
  exit 1
fi

if [[ ! -f "$EXPORT_PLIST" ]]; then
  echo "Error: ExportOptions.plist not found: $EXPORT_PLIST" >&2
  echo "Copy example/example_export_options_macos.plist to macos/ExportOptions.plist and set teamID." >&2
  exit 1
fi

if [[ ! -d "$WORKSPACE" ]]; then
  echo "Error: Xcode workspace not found: $WORKSPACE" >&2
  echo "Expected Flutter default: macos/Runner.xcworkspace (set SCHEME if you use a custom scheme)." >&2
  exit 1
fi

if [[ -n "${ASC_API_KEY_PATH:-}" ]]; then
  API_PRIVATE_KEYS_DIR="$(cd "$(dirname "$ASC_API_KEY_PATH")" && pwd)"
  export API_PRIVATE_KEYS_DIR
fi

echo "==> App directory: $APP_DIR"
echo "==> flutter pub get"
( cd "$APP_DIR" && flutter pub get )

if [[ "$POD_INSTALL_REPO_UPDATE" == true ]]; then
  echo "==> pod install (macos) with --repo-update"
  ( cd "$MACOS_DIR" && pod install --repo-update )
else
  echo "==> pod install (macos)"
  ( cd "$MACOS_DIR" && pod install )
fi

mkdir -p "$BUILD_ROOT"

echo "==> xcodebuild archive (Release, automatic signing from project / export plist)"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=macOS" \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic \
  archive

rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

echo "==> xcodebuild -exportArchive (App Store package)"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_PLIST" \
  -allowProvisioningUpdates

PKG_FILE=$(find "$EXPORT_DIR" -maxdepth 1 -name "*.pkg" -print -quit || true)
if [[ -z "$PKG_FILE" ]]; then
  echo "Error: No .pkg found under $EXPORT_DIR after export." >&2
  echo "Check macos/ExportOptions.plist (method should be app-store-connect; teamID must match your Apple team)." >&2
  exit 1
fi

echo "==> Exported: $PKG_FILE"

if [[ "$BUILD_ONLY" == true ]]; then
  echo "Build finished (--build-only). Upload manually with Transporter or altool."
  exit 0
fi

if [[ -z "${ASC_API_KEY_ID:-}" || -z "${ASC_API_ISSUER_ID:-}" ]]; then
  echo "Error: Set ASC_API_KEY_ID and ASC_API_ISSUER_ID (e.g. macos_testflight.app_store_key_json_path or api_* in tunai_build_script_config.json), or pass --build-only." >&2
  exit 1
fi

if [[ -z "${API_PRIVATE_KEYS_DIR:-}" ]]; then
  echo "Error: Set macos_testflight.app_store_key_json_path, or api_private_key_path, or ASC_API_KEY_PATH / API_PRIVATE_KEYS_DIR (AuthKey_${ASC_API_KEY_ID}.p8)." >&2
  exit 1
fi

echo "==> Uploading to App Store Connect (macOS)…"
xcrun altool \
  --upload-app \
  --file "$PKG_FILE" \
  --type macos \
  --apiKey "$ASC_API_KEY_ID" \
  --apiIssuer "$ASC_API_ISSUER_ID"

echo "Upload finished. Processing in App Store Connect can take several minutes; then the build appears in TestFlight."
