#!/usr/bin/env node
// Entry point of the `shop` command; see main.js.

import { run } from './main.js';

process.exitCode = await run(process.argv.slice(2));
