import test from 'node:test';
import assert from 'node:assert/strict';
import { updateBuildGradle } from '../node/lib/bump.mjs';

test('a feature bump updates a single-quoted Groovy versionName, keeping its quotes', () => {
  const before = "        versionCode 405\n        versionName '2.0.0'\n";
  assert.equal(updateBuildGradle(before, '2.1.0', 405), "        versionCode 405\n        versionName '2.1.0'\n");
});

test('double-quoted Kotlin DSL fields and Flutter placeholders still update', () => {
  assert.equal(updateBuildGradle('versionCode = 1\nversionName = "1.0.0"\n', '1.1.0', 2), 'versionCode = 2\nversionName = "1.1.0"\n');
  assert.equal(updateBuildGradle('versionCode flutter.versionCode\nversionName flutter.versionName\n', '3.0.0', 7), 'versionCode 7\nversionName "3.0.0"\n');
});
