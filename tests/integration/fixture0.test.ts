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

import { Schema as S } from 'effect';

import assert from 'node:assert/strict';
import { test } from 'node:test';


const exec = promisify(execCallback);

test('fixture0', { timeout: 30_000/*ms*/ }, async (t) => {
  const before = async () => {
    const cwd = path.dirname(fileURLToPath(import.meta.url));
    console.log('Preparing fixture0...');
    
    try {
      const { stdout, stderr } = await exec(`./generate_fixture.sh fixture0`, { cwd });
    } catch (error: unknown) {
      if (error instanceof Error && 'stderr' in error) {
        console.error(error.stderr);
      }
      throw error;
    }
  };
  await before();
  
  // @ts-ignore Will not type check until the generation is complete.
  const fixture = await import('../project_simulation/generated/fixture0/fixture0.ts');
  
  await t.test('User', async (t) => {
    const user1 = {
      id: '5141C532-90CA-4F12-B3EC-22776F9DDD80',
      name: 'Alice',
      last_logged_in: '2024-05-25T19:20:39.482Z',
      role: 'USER',
      interests: [
        { name: 'Music', description: null },
      ],
    };
    assert.deepStrictEqual(S.decodeUnknownSync(fixture.User)(user1), {
      ...user1,
      last_logged_in: new Date('2024-05-25T19:20:39.482Z'), // Transformed to Date
      interests: [
        { name: 'Music', description: null, subcategories: {} }, // Added default value
      ],
    });
  });
});
