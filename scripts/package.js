import { join } from 'node:path';
import { privateDirectory } from '../src/config.js';
import { createPackage } from '../src/packaging.js';
import { safeCode } from '../src/foundation.js';

try { console.log(JSON.stringify(createPackage(privateDirectory, join(process.cwd(), 'dist')), null, 2)); }
catch (error) { console.error(`ARGUS: ${safeCode(error)}`); process.exitCode = 1; }