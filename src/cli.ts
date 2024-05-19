#!/usr/bin/env node

import { run } from './openapiToEffect.ts';


const main = async () => {
  const [_argExec, _argScript, ...args] = process.argv; // First two arguments should be the executable + script
  try {
    await run(args);
    process.exit(0);
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
};

await main();
