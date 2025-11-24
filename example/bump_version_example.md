# Bump Version Script - Usage Examples

The `bump_version.dart` script automatically updates version numbers in your Flutter project's `pubspec.yaml`, `Info.plist` (iOS), and `build.gradle` (Android) files.

## Basic Usage

### From the current directory

If you're in your Flutter app directory:

```bash
# Bump patch version (0.0.1 -> 0.0.2)
dart run bin/bump_version.dart patch

# Bump minor version (0.0.1 -> 0.1.0)
dart run bin/bump_version.dart minor

# Bump major version (0.0.1 -> 1.0.0)
dart run bin/bump_version.dart major

# Bump build number (0.0.1+1 -> 0.0.1+2)
dart run bin/bump_version.dart build
```

### From a different directory

If you want to specify the app directory:

```bash
dart run bin/bump_version.dart patch --app-dir /path/to/your/flutter/app
```

## Version Bump Types

### Patch (Bug fixes)

Increments the patch version number:

- `0.0.1` → `0.0.2`
- `1.2.3` → `1.2.4`
- `2.5.0+10` → `2.5.1+10` (build number stays the same)

### Minor (New features, backward compatible)

Increments the minor version and resets patch:

- `0.0.1` → `0.1.0`
- `1.2.3` → `1.3.0`
- `2.5.4+10` → `2.6.0+10` (build number stays the same)

### Major (Breaking changes)

Increments the major version and resets minor and patch:

- `0.0.1` → `1.0.0`
- `1.2.3` → `2.0.0`
- `2.5.4+10` → `3.0.0+10` (build number stays the same)

### Build (Build number only)

Increments only the build number:

- `0.0.1` → `0.0.1+1` (if no build number exists)
- `0.0.1+1` → `0.0.1+2`
- `1.2.3+10` → `1.2.3+11`

## What Gets Updated

The script updates version information in three places:

1. **pubspec.yaml**

   - Updates the `version:` field
   - Format: `version: 1.2.3+4` (version name + build number)

2. **ios/Runner/Info.plist** (if exists)

   - Updates `CFBundleShortVersionString` (version name)
   - Updates `CFBundleVersion` (build number)

3. **android/app/build.gradle** (if exists)
   - Updates `versionName` (version name)
   - Updates `versionCode` (build number)

## Example Workflow

```bash
# Start with version 1.0.0
# Make some bug fixes
dart run bin/bump_version.dart patch
# Now version is 1.0.1

# Add new features
dart run bin/bump_version.dart minor
# Now version is 1.1.0

# Make breaking changes
dart run bin/bump_version.dart major
# Now version is 2.0.0

# Just increment build number for a new build
dart run bin/bump_version.dart build
# Now version is 2.0.0+1
```

## Output Example

When you run the script, you'll see output like this:

```
Bumping patch version in: /path/to/your/app
Current version: 0.0.1
New version: 0.0.2
✓ Updated pubspec.yaml
✓ Updated Info.plist
✓ Updated build.gradle

Version bump completed successfully!
```

## Notes

- The script will skip files that don't exist (e.g., if you don't have iOS or Android folders)
- The script preserves the original formatting of files when possible
- Make sure you're in a git repository or have backups before running, as the script modifies files directly
