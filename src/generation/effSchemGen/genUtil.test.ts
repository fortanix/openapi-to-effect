/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type GenResult, GenResultUtil } from './genUtil.ts';


test('genUtil', (t) => {
  t.test('combineRefs', (t) => {
    t.test('should return the unique combination of refs', (t) => {
      const refs1: GenResult['refs'] = ['#/components/schemas/A', '#/components/schemas/B'];
      const refs2: GenResult['refs'] = ['#/components/schemas/B', '#/components/schemas/C'];
      
      const refsCombined: GenResult['refs'] = GenResultUtil.combineRefs(refs1, refs2);
      
      assert.deepStrictEqual(refsCombined, [
        '#/components/schemas/A',
        '#/components/schemas/B',
        '#/components/schemas/C',
      ]);
    });
  });
});
