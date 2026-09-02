import { spawn } from 'child_process';

/**
 * @param {string} cwd
 * @param {string} command
 * @param {string[]} args
 * @param {{env?: NodeJS.ProcessEnv}} options
 * @returns {Promise<number>} exit code
 */
export function runInherit(cwd, command, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env,
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) resolve(1);
      else resolve(code ?? 1);
    });
  });
}
