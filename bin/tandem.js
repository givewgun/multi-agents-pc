#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`tandem: ${err.message}\n`);
  process.exitCode = 1;
});
