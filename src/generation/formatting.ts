/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { format as prettierFormat } from 'prettier';


/**
 * @throws SyntaxError When the `generatedCode` is not syntactically valid.
 */
export const formatGeneratedCode = async (generatedCode: string): Promise<string> => {
  return '\n' + await prettierFormat(generatedCode, {
    parser: 'babel-ts',
    plugins: ['prettier-plugin-jsdoc'],
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
  });
};
