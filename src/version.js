import { readFileSync } from 'node:fs';

const PKG_URL = new URL('../package.json', import.meta.url);
export const VERSION = JSON.parse(readFileSync(PKG_URL, 'utf8')).version;
