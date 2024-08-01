
import { dedent } from 'ts-dedent';
import { AST } from '@effect/schema';

import { type GenerationSpec } from '../../src/generation/generationSpec.ts';
import { GenResultUtil, type GenResult } from '../../src/generation/effSchemGen/genUtil.ts';
import { type OpenAPIV3_1 as OpenAPIV3 } from 'openapi-types';


const parseOptions: AST.ParseOptions = {
  errors: 'all',
  onExcessProperty: 'ignore',
};

export default {
  patch: [
    // `Sobject.kid` field should be required (PROD-6903)
    { op: 'add', path: '/components/schemas/Sobject/allOf/0/required/-', value: 'kid' },
    // `Sobject.never_exportable` field should be required (TODO: create ticket)
    { op: 'add', path: '/components/schemas/Sobject/allOf/0/required/-', value: 'never_exportable' },
    // https://fortanix.atlassian.net/browse/PROD-8584
    { op: 'remove', path: '/components/schemas/WrappingKeyName/oneOf/0' },
    // https://fortanix.atlassian.net/browse/PROD-8585
    {
      op: 'add',
      path: '/components/schemas/RemovablePluginCodeSigningPolicy',
      value: {
        oneOf: [
          {
            type: 'string',
            enum: ['remove'],
          },
          {
            $ref: '#/components/schemas/PluginCodeSigningPolicy',
          },
        ],
      },
    },
  ],
  
  generationMethod: { method: 'bundled', bundleName: 'fixture1' },
  
  hooks: {
    optionalFieldRepresentation: 'nullish',
    generateNumberType(schema: OpenAPIV3.NonArraySchemaObject): null | GenResult {
      // Special handling for certain integer types generated in Roche
      if (schema.type === 'integer' && schema.minimum === 0 && schema.maximum === 2**32 - 1) {
        // Clear the fields we're handling as part of this hook
        delete schema.minimum; // FIXME: do this without mutation
        delete schema.maximum;
        return {
          ...GenResultUtil.initGenResult(),
          code: `RocheUInt32`,
          refs: GenResultUtil.combineRefs(['./util/RocheUInt32.ts']), // FIXME: better refs/runtime system
        };
      }
      return null;
    },
    generateStringType(schema: OpenAPIV3.NonArraySchemaObject): null | GenResult {
      if (schema.pattern === '^[^\\n]*[^\\s\\n][^\\n]*$' && schema.maxLength === 4096) { // Roche names
        // Clear the fields we're handling as part of this hook
        delete schema.maxLength; // FIXME: do this without mutation
        return {
          ...GenResultUtil.initGenResult(),
          code: `RocheName`,
          refs: GenResultUtil.combineRefs(['./util/RocheName.ts']), // FIXME: better refs/runtime system
        };
      } else if (schema.pattern === '^\\d{4}\\d{2}\\d{2}T\\d{2}\\d{2}\\d{2}Z$') { //  ISO 8601 basic format
        return {
          ...GenResultUtil.initGenResult(),
          code: `RocheDate`,
          refs: GenResultUtil.combineRefs(['./util/RocheDate.ts']), // FIXME: better refs/runtime system
        };
      } else if (schema.pattern === '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$') { // ISO 8601 extended format
        return {
          ...GenResultUtil.initGenResult(),
          code: `RocheDate`,
          refs: GenResultUtil.combineRefs(['./util/RocheDate.ts']), // FIXME: better refs/runtime system
        };
      }
      return null;
    },
  },
  runtime: {
    /*
    './util/RocheOption.ts': {
      definitions: [
        {
          action: 'custom-code',
          schemaId: 'RocheOption',
          code: dedent`
            const RocheOption = <A, I>(FieldSchema: S.Schema<A, I, never>) => {
              const FieldSchemaNullish = S.NullishOr(FieldSchema); // The "from" schema
              const FieldSchemaNullable = S.NullOr(FieldSchema); // The "to" schema
              
              type FA = undefined | null | A;
              type FI = undefined | null | I;
              type TA = null | A;
              type TI = null | I;
              
              // Transformation for a field property which is optional (\`?:\`) and nullish (undefined | null | A), and
              // convert it to a field that is required (\`:\`) and nullable (null | A).
              return S.optionalToRequired(FieldSchemaNullish, FieldSchemaNullable, {
                decode: (fieldNullish: Option.Option<FA>): TI => {
                  const fieldNullable: TA = Option.getOrElse(fieldNullish, () => null) ?? null;
                  return pipe(fieldNullable, S.encodeSync(FieldSchemaNullable, ${JSON.stringify(parseOptions)}));
                },
                encode: (fieldNullable: TI): Option.Option<FA> => {
                  return pipe(
                    fieldNullable,
                    S.decodeSync(FieldSchemaNullish, ${JSON.stringify(parseOptions)}),
                    Option.some,
                  );
                },
              });
            };
          `,
        },
      ],
    },
    */
    './util/RocheUInt32.ts': {
      definitions: [
        {
          action: 'custom-code',
          schemaId: 'RocheUInt32',
          code: dedent`
            export const RocheUInt32 = pipe(
              S.Number,
              S.int(),
              S.greaterThanOrEqualTo(0),
              S.lessThanOrEqualTo(4294967295),
            );
            export const RocheUInt32Encoded = S.encodedSchema(RocheUInt32);
            export type RocheUInt32 = typeof RocheUInt32.Type;
            export type RocheUInt32Encoded = typeof RocheUInt32.Encoded;
          `,
        },
      ],
    },
    './util/RocheName.ts': {
      definitions: [
        {
          action: 'custom-code',
          schemaId: 'RocheName',
          code: dedent`
            export const RocheName = pipe(
              S.String,
              S.pattern(new RegExp('^[^\\\\n]*[^\\\\s\\\\n][^\\\\n]*$')),
              S.maxLength(4096),
            );
            export const RocheNameEncoded = S.encodedSchema(RocheName);
            export type RocheName = typeof RocheName.Type;
            export type RocheNameEncoded = typeof RocheName.Encoded;
          `,
        },
      ],
    },
    './util/RocheDate.ts': {
      definitions: [
        {
          action: 'custom-code',
          schemaId: 'RocheDate',
          code: dedent`
            // FIXME: better refs/runtime system
            //import { IsoBasicDateTime } from '../../../common/codecs/IsoBasicDateTime.ts'; // <runtime>
            const IsoBasicDateTime = S.Date;
            
            // Roche will return all date-time values as an ISO 8601 "basic format" string, in UTC timezone. This basic
            // format is not supported by the native JS \`Date\` ISO parsing, so we need to transform it.
            export const RocheDate = IsoBasicDateTime;
            export const RocheDateEncoded = S.encodedSchema(RocheDate);
            export type RocheDate = typeof RocheDate.Type;
            export type RocheDateEncoded = typeof RocheDate.Encoded;
          `,
        },
      ],
    },
  },
  modules: {
    // Cycle: BatchRequest -> BatchRequestList -> BatchRequest
    './BatchRequest.ts': {
      definitions: [
        {
          action: 'generate-schema',
          schemaId: 'BatchRequest',
          typeDeclarationEncoded: dedent`(
            | { readonly Batch: typeof BatchRequestList.Encoded }
            | { readonly SingleItem: typeof BatchRequestItem.Encoded }
          )`,
          typeDeclaration: dedent`(
            | { readonly Batch: typeof BatchRequestList.Type }
            | { readonly SingleItem: typeof BatchRequestItem.Type }
          )`,
        },
      ],
    },
    // Cycle: BatchResponse -> BatchResponseList -> BatchResponse
    // './BatchResponse.ts': {
    //   definitions: [
    //     {
    //       action: 'generate-schema',
    //       schemaId: 'BatchResponse',
    //       typeDeclarationEncoded: dedent`
    //         (
    //           | { readonly Batch: typeof BatchResponseList.Encoded }
    //           | { readonly SingleItem: typeof BatchResponseObject.Encoded }
    //         )
    //       `,
    //       typeDeclaration: dedent`
    //         (
    //           | { readonly Batch: typeof BatchResponseList.Type }
    //           | { readonly SingleItem: typeof BatchResponseObject.Type }
    //         )
    //       `,
    //     },
    //   ],
    // },
    './BatchResponseList.ts': {
      definitions: [
        {
          action: 'generate-schema',
          schemaId: 'BatchResponseList',
          typeDeclarationEncoded: dedent`
            {
              items: readonly (typeof BatchResponse.Encoded)[],
            }
          `,
          typeDeclaration: dedent`
            {
              items: readonly (typeof BatchResponse.Type)[],
            }
          `,
        },
      ],
    },
    
    // Cycle: QuorumPolicy -> Quorum -> QuorumPolicy
    './QuorumPolicy.ts': {
      definitions: [
        {
          action: 'generate-schema',
          schemaId: 'QuorumPolicy',
          typeDeclarationEncoded: dedent`
            {
              quorum?: undefined | null | typeof Quorum.Encoded,
              user?: undefined | null | typeof S.UUID.Encoded,
              app?: undefined | null | typeof S.UUID.Encoded,
            }
          `,
          typeDeclaration: dedent`
            {
              quorum?: undefined | null | typeof Quorum.Type,
              user?: undefined | null | typeof S.UUID.Type,
              app?: undefined | null | typeof S.UUID.Type,
            }
          `,
        },
      ],
    },
    
    // Cycle: FpeConstraintsApplicability (self-reference)
    './FpeConstraintsApplicability.ts': {
      definitions: [
        {
          action: 'generate-schema',
          schemaId: 'FpeConstraintsApplicability',
          typeDeclarationEncoded: dedent`
            (
              | typeof All.Encoded
              // Note: this will not work if we use \`Record<>\` syntax, has to use mapped type syntax directly
              // https://stackoverflow.com/questions/42352858/type-alias-circularly-references-itself
              | { readonly [key: string]: _FpeConstraintsApplicabilityEncoded }
            )
          `,
          typeDeclaration: dedent`
            (
              | typeof All.Type
              // Note: this will not work if we use \`Record<>\` syntax, has to use mapped type syntax directly
              // https://stackoverflow.com/questions/42352858/type-alias-circularly-references-itself
              | { [key: string]: _FpeConstraintsApplicability }
            )
          `,
        },
      ],
    },
    
    //
    // Cycle: FpeDataPart -> FpeCompoundPart -> FpeCompoundPart{Or/Concat/Multiple} -> FpeDataPart
    // Note: the explicit type annotations must be on the FpeCompoundPart{Or/Concat/Multiple} branches, adding them
    // to `FpeDataPart` is not enough to resolve the circular dependency.
    //
    './FpeDataPart.ts': {
      definitions: [
        {
          action: 'generate-schema',
          schemaId: 'FpeDataPart',
          typeDeclarationEncoded: dedent`
            | typeof FpeEncryptedPart.Encoded
            | typeof FpeDataPartLiteral.Encoded
            | _FpeCompoundPartEncoded
          `,
          typeDeclaration: dedent`
            | typeof FpeEncryptedPart.Type
            | typeof FpeDataPartLiteral.Type
            | _FpeCompoundPart
          `,
        },
      ],
    },
    './FpeCompoundPart.ts': {
      definitions: [
        {
          action: 'generate-schema',
          schemaId: 'FpeCompoundPart',
          typeDeclarationEncoded: dedent`
            | _FpeCompoundPartOrEncoded
            | _FpeCompoundPartConcatEncoded
            | _FpeCompoundPartMultipleEncoded
          `,
          typeDeclaration: dedent`
            | _FpeCompoundPartOr
            | _FpeCompoundPartConcat
            | _FpeCompoundPartMultiple
          `,
        },
      ],
    },
    './FpeCompoundPartOr.ts': {
      definitions: [
        {
          action: 'generate-schema',
          schemaId: 'FpeCompoundPartOr',
          typeDeclarationEncoded: dedent`
            {
              readonly or: readonly typeof FpeDataPart.Encoded[],
              readonly constraints?: undefined | null | typeof FpeConstraints.Encoded,
              readonly preserve?: undefined | null | boolean,
              readonly mask?: undefined | null | boolean,
              readonly min_length?: undefined | null | typeof RocheUInt32.Encoded,
              readonly max_length?: undefined | null | typeof RocheUInt32.Encoded,
            }
          `,
          typeDeclaration: dedent`
            {
              readonly or: readonly typeof FpeDataPart.Type[],
              readonly constraints?: undefined | null | typeof FpeConstraints.Type,
              readonly preserve?: undefined | null | boolean,
              readonly mask?: undefined | null | boolean,
              readonly min_length?: undefined | null | typeof RocheUInt32.Type,
              readonly max_length?: undefined | null | typeof RocheUInt32.Type,
            }
          `,
        },
      ],
    },
    './FpeCompoundPartConcat.ts': {
      definitions: [
        {
          action: 'generate-schema',
          schemaId: 'FpeCompoundPartConcat',
          typeDeclarationEncoded: dedent`
            {
              readonly concat: readonly typeof FpeDataPart.Encoded[],
              readonly constraints?: undefined | null | typeof FpeConstraints.Encoded,
              readonly preserve?: undefined | null | boolean,
              readonly mask?: undefined | null | boolean,
              readonly min_length?: undefined | null | typeof RocheUInt32.Encoded,
              readonly max_length?: undefined | null | typeof RocheUInt32.Encoded,
            }
          `,
          typeDeclaration: dedent`
            {
              readonly concat: readonly typeof FpeDataPart.Type[],
              readonly constraints?: undefined | null | typeof FpeConstraints.Type,
              readonly preserve?: undefined | null | boolean,
              readonly mask?: undefined | null | boolean,
              readonly min_length?: undefined | null | typeof RocheUInt32.Type,
              readonly max_length?: undefined | null | typeof RocheUInt32.Type,
            }
          `,
        },
      ],
    },
    './FpeCompoundPartMultiple.ts': {
      definitions: [
        {
          action: 'generate-schema',
          schemaId: 'FpeCompoundPartMultiple',
          typeDeclarationEncoded: dedent`
            {
              readonly multiple: typeof FpeDataPart.Encoded,
              readonly min_repetitions?: undefined | null | number,
              readonly max_repetitions?: undefined | null | number,
              readonly constraints?: undefined | null | typeof FpeConstraints.Encoded,
              readonly preserve?: undefined | null | boolean,
              readonly mask?: undefined | null | boolean,
              readonly min_length?: undefined | null | typeof RocheUInt32.Encoded,
              readonly max_length?: undefined | null | typeof RocheUInt32.Encoded,
            }
          `,
          typeDeclaration: dedent`
            {
              readonly multiple: typeof FpeDataPart.Type,
              readonly min_repetitions?: undefined | null | number,
              readonly max_repetitions?: undefined | null | number,
              readonly constraints?: undefined | null | typeof FpeConstraints.Type,
              readonly preserve?: undefined | null | boolean,
              readonly mask?: undefined | null | boolean,
              readonly min_length?: undefined | null | typeof RocheUInt32.Type,
              readonly max_length?: undefined | null | typeof RocheUInt32.Type,
            }
          `,
        },
      ],
    },
  },
} satisfies GenerationSpec;
