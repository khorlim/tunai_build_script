import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  archiveSigningFromExportOptions,
  withIosArchiveSigning,
} from '../node/lib/ios-archive-signing.mjs';
import { runInherit } from '../node/lib/run.mjs';

const signing = {
  target: 'Runner', teamId: 'ABCDEFGHIJ',
  certificate: 'Apple Distribution', profile: 'match AdHoc com.example.app',
};

test('archive signing is visible to the child only and cleaned up after success or failure', async () => {
  for (const exitCode of [0, 7]) {
    const env = { ...process.env };
    delete env.XCODE_XCCONFIG_FILE;
    let configPath;
    const code = await withIosArchiveSigning(signing, async (childEnv) => {
      configPath = childEnv.XCODE_XCCONFIG_FILE;
      assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
      return runInherit(process.cwd(), process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs';
        import assert from 'node:assert/strict';
        const config = fs.readFileSync(process.env.XCODE_XCCONFIG_FILE, 'utf8');
        assert.ok(config.includes('CODE_SIGN_IDENTITY[sdk=iphoneos*] = Apple Distribution'));
        assert.ok(config.includes('TUNAI_ARCHIVE_PROFILE_Runner = match AdHoc com.example.app'));
        assert.ok(config.includes('PROVISIONING_PROFILE_SPECIFIER = $(TUNAI_ARCHIVE_PROFILE_$(TARGET_NAME))'));
        process.exit(${exitCode});
      `], { env: childEnv });
    }, env);
    assert.equal(code, exitCode);
    assert.equal(env.XCODE_XCCONFIG_FILE, undefined);
    assert.equal(fs.existsSync(path.dirname(configPath)), false);
  }
});

test('archive signing cleanup also runs when spawning throws', async () => {
  let configPath;
  await assert.rejects(withIosArchiveSigning(signing, async (env) => {
    configPath = env.XCODE_XCCONFIG_FILE;
    throw new Error('spawn failed');
  }, {}), /spawn failed/);
  assert.equal(fs.existsSync(path.dirname(configPath)), false);
});

test('non-RC builds retain their environment and RC refuses conflicting overrides', async () => {
  const env = { XCODE_XCCONFIG_FILE: '/existing/custom.xcconfig' };
  assert.equal(await withIosArchiveSigning(null, async (actual) => actual, env), env);
  await assert.rejects(withIosArchiveSigning(signing, () => assert.fail('must not run'), env), /Unset XCODE_XCCONFIG_FILE/);
});

test('signing preflight rejects automatic, development, incomplete and unsafe configurations', () => {
  const options = {
    signingStyle: 'manual', teamID: signing.teamId,
    signingCertificate: signing.certificate,
    provisioningProfiles: { 'com.example.app': signing.profile },
  };
  assert.deepEqual(archiveSigningFromExportOptions(options, 'com.example.app'), signing);
  for (const override of [
    { signingStyle: 'automatic' },
    { teamID: undefined },
    { signingCertificate: 'Apple Development' },
    { provisioningProfiles: { 'com.example.app': 'profile\nCODE_SIGNING_ALLOWED = NO' } },
    { provisioningProfiles: { 'com.example.app': '$(OTHER_PROFILE)' } },
    { provisioningProfiles: { 'com.example.app': 'one', 'com.example.app.extension': 'two' } },
  ]) {
    assert.throws(() => archiveSigningFromExportOptions({ ...options, ...override }, 'com.example.app'));
  }
});
