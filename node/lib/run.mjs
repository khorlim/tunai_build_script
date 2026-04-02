import { spawn } from 'child_process';

/**
 * @param {string} cwd
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<number>} exit code
 */
export function runInherit(cwd, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) resolve(1);
      else resolve(code ?? 1);
    });
  });
}
