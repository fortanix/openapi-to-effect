/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { dedent } from 'ts-dedent';
import { type OpenAPIV3_1 as OpenAPIV3 } from 'openapi-types';
import { type OpenApiRef } from '../../util/openapi.ts';


export type GenComments = {
  commentShort: string,
  commentLong: string,
  deprecated: boolean,
  format?: undefined | string,
};
export type GenResult = {
  code: string,
  refs: Array<OpenApiRef>,
  comments: GenComments,
};
export const GenResultUtil = {
  combineRefs(...refs: Array<GenResult['refs']>): GenResult['refs'] {
    return [...new Set(refs.flat())];
  },
  importNameFromRef(ref: string) {
    const fileName = ref.split('/').at(-1);
    if (!fileName) { throw new Error(`Invalid ref: ${ref}`); }
    const importName = fileName.replace(/\.ts$/, '');
    return importName;
  },
  
  initComments(): GenComments {
    return {
      commentShort: '',
      commentLong: '',
      deprecated: false,
      //format: undefined,
    };
  },
  initGenResult(): GenResult {
    return {
      code: '',
      refs: [],
      comments: GenResultUtil.initComments(),
    };
  },
  
  commentsFromSchemaObject(schema: OpenAPIV3.BaseSchemaObject): GenComments {
    return {
      commentShort: schema.title ?? '',
      commentLong: schema.description ?? '',
      deprecated: schema.deprecated ?? false,
      format: schema.format,
    };
  },
  commentsToCode(comments: GenComments): { commentBlock: string, commentInline: string } {
    const commentBlock = dedent`
      ${comments.commentLong}
      ${comments.deprecated ? `@deprecated` : ''}
    `.trim();
    const commentInline = comments.commentShort.split('\n').join(' ').trim();
    return {
      commentBlock: commentBlock === '' ? '' : `/** ${commentBlock} */`,
      commentInline: commentInline === '' ? '' : `// ${commentInline}`,
    };
  },
  
  generatePipe(pipe: Array<string>): string {
    const head: undefined | string = pipe[0];
    if (head === undefined) { throw new TypeError(`generatePipe needs at least one argument`); }
    if (pipe.length === 1) { return head; }
    return `pipe(${pipe.join(', ')})`;
  },
  
  // Convert an arbitrary name to a JS identifier
  encodeIdentifier(name: string): string {
    if (/^[a-zA-Z$_][a-zA-Z0-9$_]*$/g.test(name)) {
      return name;
    } else {
      const nameSpecialCharsRemoved = name.replace(/[^a-zA-Z0-9$_]/g, '');
      if (/^[0-9]/.test(nameSpecialCharsRemoved)) {
        return '_' + nameSpecialCharsRemoved;
      } else {
        return nameSpecialCharsRemoved;
      }
    }
  },
};
