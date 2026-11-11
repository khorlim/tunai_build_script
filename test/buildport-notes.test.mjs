import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveBuildportNotes } from '../node/lib/build.mjs';

test('release notes come from --notes-file, then --notes, then buildport.notes_path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buildport-notes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'flag.md'), '## From flag file\n');
  fs.writeFileSync(path.join(root, 'config.md'), '## From config\n');
  const buildport = { notes_path: 'config.md' };

  assert.equal(
    resolveBuildportNotes({ projectRoot: root, notes: { file: path.join(root, 'flag.md'), text: 'inline' }, buildport }),
    '## From flag file',
  );
  assert.equal(resolveBuildportNotes({ projectRoot: root, notes: { text: ' inline ' }, buildport }), 'inline');
  assert.equal(resolveBuildportNotes({ projectRoot: root, notes: {}, buildport }), '## From config');
  assert.equal(resolveBuildportNotes({ projectRoot: root, notes: {}, buildport: {} }), '');
  assert.equal(resolveBuildportNotes({ projectRoot: root, notes: {}, buildport: { notes_path: 'missing.md' } }), '');
  assert.throws(
    () => resolveBuildportNotes({ projectRoot: root, notes: { file: path.join(root, 'missing.md') } }),
    /Notes file not found/,
  );
});
