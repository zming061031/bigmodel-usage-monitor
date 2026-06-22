import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(rootDir, 'dist', 'index.html');
const dashboardPath = path.join(rootDir, 'dist', 'dashboard.html');

if (!fs.existsSync(indexPath)) {
  throw new Error('dist/index.html does not exist. Run vite build first.');
}

fs.copyFileSync(indexPath, dashboardPath);
console.log('Created dist/dashboard.html');
