import fs from 'fs';
import path from 'path';

export function detectPlatform(projectRoot) {
  const ios = fs.existsSync(path.join(projectRoot, 'ios'));
  const android = fs.existsSync(path.join(projectRoot, 'android'));
  if (ios && android) return null;
  if (ios) return 'ios';
  if (android) return 'android';
  return null;
}
