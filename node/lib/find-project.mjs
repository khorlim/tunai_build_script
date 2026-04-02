import fs from 'fs';
import path from 'path';

export const CONFIG_FILENAME = 'tunai_build_script_config.json';

/**
 * Walk up from startDir for tunai_build_script_config.json.
 * @returns {{ projectRoot: string, configPath: string } | null}
 */
export function findProjectWithConfig(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);
  while (true) {
    const configPath = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(configPath)) {
      return { projectRoot: dir, configPath };
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}
