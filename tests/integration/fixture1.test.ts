/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec as execCallback } from 'node:child_process';

import { Schema as S } from '@effect/schema';

import assert from 'node:assert/strict';
import { test } from 'node:test';


const exec = promisify(execCallback);

test('fixture1', { timeout: 30_000/*ms*/ }, async (t) => {
  const before = async () => {
    const cwd = path.dirname(fileURLToPath(import.meta.url));
    console.log('Preparing fixture1...');
    
    try {
      const { stdout, stderr } = await exec(`./generate_fixture.sh fixture1`, { cwd });
    } catch (error: unknown) {
      if (error instanceof Error && 'stderr' in error) {
        console.error(error.stderr);
      }
      throw error;
    }
  };
  await before();
  
  // @ts-ignore Will not type check until the generation is complete.
  const fixture = await import('../project_simulation/generated/fixture1/fixture1.ts');
  
  await t.test('RocheName', async (t) => {
    assert.strictEqual(S.decodeSync(fixture.RocheName)('test'), 'test');
    assert.throws(() => S.decodeSync(fixture.RocheName)(''), /Expected a string matching/);
  });
});
