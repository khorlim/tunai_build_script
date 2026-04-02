import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/** Directory containing package.json (npm package / git checkout root). */
export function getPackageRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..');
}
