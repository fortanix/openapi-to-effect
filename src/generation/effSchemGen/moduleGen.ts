/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { dedent } from 'ts-dedent';
import { type OpenApiSchemaId, type OpenApiSchema } from '../../util/openapi.ts';

import { GenResultUtil } from './genUtil.ts';
import { type Context as SchemaGenContext, generateForSchema } from './schemaGen.ts';


const id = GenResultUtil.encodeIdentifier;

// Take an OpenAPI schema and generate a top-level module, as a string.
// @throws Error When we cannot generate a module from the given schema.
export const generateModule = (schemaId: string, schema: OpenApiSchema): string => {
  const generationContext: SchemaGenContext = {
    schemas: {}, // FIXME
    hooks: {},
    isSchemaIdBefore(_schemaId: OpenApiSchemaId) { return true; },
  };
  const { code, refs, comments } = generateForSchema(generationContext, schema);
  const commentsGenerated = GenResultUtil.commentsToCode(comments);
  
  const fileNameForRef = (ref: string): undefined | string => ref.split('/').at(-1);
  const schemaIdForRef = (ref: string): undefined | string => fileNameForRef(ref)?.replace(/\.ts$/, '');
  
  const refsSorted = [...refs]
    .filter(ref => schemaIdForRef(ref) !== schemaId)
    .sort((ref1, ref2) => {
      if (ref1.startsWith('../util/')) {
        return -1;
      } else if (ref2.startsWith('../util/')) {
        return +1;
      }
      return 0;
    });
  return dedent`
    import { pipe, Option } from 'effect';
    import { Schema as S } from '@effect/schema';
    
    ${refsSorted.map(ref => {
      const refId = schemaIdForRef(ref);
      if (!refId) { throw new Error(`Invalid ref: ${ref}`); }
      return `import { ${id(refId)} } from '${ref}';`;
    }).join('\n')}
    
    ${commentsGenerated.commentBlock}
    export const ${id(schemaId)} = ${code}; ${commentsGenerated.commentInline}
    export type ${id(schemaId)} = S.Schema.Type<typeof ${id(schemaId)}>;
    export const ${id(schemaId)}Encoded = S.encodedSchema(${id(schemaId)});
    export type ${id(schemaId)}Encoded = S.Schema.Encoded<typeof ${id(schemaId)}>;
  `;
};
