/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { dedent } from 'ts-dedent';
import { type OpenAPIV3_1 as OpenApi } from 'openapi-types';
import { OpenApiSchemaId, type OpenApiRef, type OpenApiSchema } from '../../util/openapi.ts';

import * as GenSpec from '../generationSpec.ts';
import { isObjectSchema } from '../../analysis/GraphAnalyzer.ts';
import { type GenResult, GenResultUtil } from './genUtil.ts';


export type Context = {
  schemas: Record<string, OpenApiSchema>,
  hooks: GenSpec.GenerationHooks,
  isSchemaIdBefore: (schemaId: OpenApiSchemaId) => boolean,
};

export const generateForNullSchema = (ctx: Context, schema: OpenApi.NonArraySchemaObject): GenResult => {
  return {
    code: `S.Null`,
    refs: [],
    comments: GenResultUtil.commentsFromSchemaObject(schema),
  };
};

export const generateForStringSchema = (ctx: Context, schema: OpenApi.NonArraySchemaObject): GenResult => {
  let refs: GenResult['refs'] = [];
  const code = ((): string => {
    if (Array.isArray(schema.enum)) {
      if (!schema.enum.every(value => typeof value === 'string')) {
        throw new TypeError(`Unknown enum value, expected string array: ${JSON.stringify(schema.enum)}`);
      }
      return dedent`S.Literal(
        ${schema.enum.map((value: string) => JSON.stringify(value) + ',').join('\n')}
      )`;
    }
    
    let baseSchema = `S.String`;
    switch (schema.format) {
      case 'uuid': baseSchema = `S.UUID`; break;
      //case 'date': baseSchema = `S.Date`; // FIXME: validate lack of time component
      case 'date-time': baseSchema = `S.Date`; break;
      // FIXME: using `S.Base64` will result in `Uint8Array` rather than strings, which will break some downstream
      // consumers.
      //case 'byte': baseSchema = `S.Base64`; break;
    }
    
    let pipe: Array<string> = [baseSchema];
    
    // Note: no built-in validator for emails, see https://github.com/effect-ts/effect/tree/main/packages/schema#email
    if (schema.format === 'email') { pipe.push(`S.pattern(/.+@.+/)`); }
    
    if (typeof schema.pattern === 'string') {
      pipe.push(`S.pattern(new RegExp(${JSON.stringify(schema.pattern)}))`);
    }
    
    if (typeof schema.minLength === 'number') { pipe.push(`S.minLength(${schema.minLength})`); }
    if (typeof schema.maxLength === 'number') { pipe.push(`S.maxLength(${schema.maxLength})`); }
    
    // Run hook
    const hookResult = ctx.hooks.generateStringType?.(schema) ?? null;
    if (hookResult !== null) {
      refs = GenResultUtil.combineRefs(refs, hookResult.refs);
      pipe = [hookResult.code];
    }
    
    //if (schema.nullable) { pipe.push(`S.NullOr`); }
    
    return GenResultUtil.generatePipe(pipe);
  })();
  return {
    code,
    refs,
    comments: GenResultUtil.commentsFromSchemaObject(schema),
  };
};

export const generateForNumberSchema = (
  ctx: Context,
  schema: OpenApi.NonArraySchemaObject,
): GenResult => {
  let refs: GenResult['refs'] = [];
  const code = ((): string => {
    if (Array.isArray(schema.enum)) {
      if (!schema.enum.every(value => typeof value === 'number')) {
        throw new TypeError(`Unknown enum value, expected number array: ${JSON.stringify(schema.enum)}`);
      }
      return dedent`S.Literal(
        ${schema.enum.map((value: number) => JSON.stringify(value) + ',').join('\n')}
      )`;
    }
    
    let baseSchema = `S.Number`;
    switch (schema.format) {
      //case 'date': baseSchema = `S.Date`; break; // FIXME: validate lack of time component
      case 'date-time': baseSchema = `S.DateFromNumber.pipe(S.validDate())`; break;
    }
    
    let pipe: Array<string> = [baseSchema];
    if (schema.type === 'integer') { pipe.push(`S.int()`); }
    
    // Run hook
    const hookResult = ctx.hooks.generateNumberType?.(schema) ?? null;
    if (hookResult !== null) {
      refs = GenResultUtil.combineRefs(refs, hookResult.refs);
      pipe = [hookResult.code];
    }
    
    if (typeof schema.minimum === 'number') { pipe.push(`S.greaterThanOrEqualTo(${schema.minimum})`); }
    if (typeof schema.maximum === 'number') { pipe.push(`S.lessThanOrEqualTo(${schema.maximum})`); }
    if (typeof schema.exclusiveMinimum === 'number') { pipe.push(`S.greaterThan(${schema.exclusiveMinimum})`); }
    if (typeof schema.exclusiveMaximum === 'number') { pipe.push(`S.lessThan(${schema.exclusiveMaximum})`); }
    //if (schema.nullable) { pipe.push(`S.NullOr`); }
    
    return GenResultUtil.generatePipe(pipe);
  })();
  return {
    code,
    refs,
    comments: GenResultUtil.commentsFromSchemaObject(schema),
  };
};

export const generateForBooleanSchema = (ctx: Context, schema: OpenApi.NonArraySchemaObject): GenResult => {
  const code = ((): string => {
    if (Array.isArray(schema.enum)) { throw new Error(`Boolean enum currently not supported`); }
    
    let code = `S.Boolean`;
    //if (schema.nullable) { code = `S.NullOr(${code})`; }
    return code;
  })();
  return {
    code,
    refs: [],
    comments: GenResultUtil.commentsFromSchemaObject(schema),
  };
};

// Format a property name as valid JS identifier, to be used in a JS object literal
const propertyNameAsIdentifier = (propertyName: string): string => {
  if (!(/^[a-zA-Z$_][a-zA-Z0-9$_]*$/g.test(propertyName))) {
    return `'${propertyName.replaceAll(/'/g, '\\\'')}'`;
  }

  return propertyName;
};

export const generateFieldsForObjectSchema = (ctx: Context, schema: OpenApi.NonArraySchemaObject): GenResult => {
  const propSchemas: Record<string, OpenApiSchema> = schema.properties ?? {};
  const propsRequired: Set<string> = new Set(schema.required ?? []);
  
  let refs: GenResult['refs'] = [];
  
  const code = Object.entries(propSchemas).map(([propName, propSchema], propIndex) => {
    const propResult = generateForSchema(ctx, propSchema);
    
    // Merge refs
    refs = GenResultUtil.combineRefs(refs, propResult.refs);
    
    const commentsGenerated = GenResultUtil.commentsToCode(propResult.comments);
    let propCode = propResult.code;
    
    // If the prop is optional, mark it as `S.optional()`
    if (!propsRequired.has(propName)) {
      type OptionalParams = { exact?: boolean, default?: string };
      const optionalParams: OptionalParams = {};
      const printOptionalParams = (optionalParams: OptionalParams): string => {
        if (Object.keys(optionalParams).length === 0) { return ''; }
        return `, {
          ${Object.hasOwn(optionalParams, 'exact') ? `exact: ${optionalParams.exact},` : ''}
          ${Object.hasOwn(optionalParams, 'default') ? `default: ${optionalParams.default}` : ''}
        }`;
      };
      
      const hasDefault = 'default' in propSchema && typeof propSchema.default !== 'undefined';
      if (hasDefault) {
        if (typeof propSchema.default === 'object' && propSchema.default !== null) {
          // Add parens for object literals when used as arrow function return value
          optionalParams.default = `() => (${JSON.stringify(propSchema.default)})`;
        } else {
          optionalParams.default = `() => ${JSON.stringify(propSchema.default)}`;
        }
      }
      
      if (ctx.hooks.optionalFieldRepresentation === 'nullish') {
        propCode = `S.optional(S.NullOr(${propCode})${printOptionalParams(optionalParams)})`;
      } else {
        propCode = `S.optional(${propCode}${printOptionalParams(optionalParams)})`;
      }
    }
    
    // Handle (custom/hacked in) `x-heading` fields to group certain fields with a heading comment
    const propNeedsSeparator = propIndex > 0 && 'x-heading' in propSchema;
    const propHeading: null | string = 'x-heading' in propSchema ? propSchema['x-heading'] as string : null;
    const propHeadingComment: null | string = propHeading !== null && propHeading.startsWith('//')
      ? propHeading
      : null;
    
    return (propNeedsSeparator ? '\n\n' : '') + dedent`
      ${propHeadingComment ?? ''}${commentsGenerated.commentBlock ? `\n${commentsGenerated.commentBlock}` : ''}
      ${propertyNameAsIdentifier(propName)}: ${propCode}, ${commentsGenerated.commentInline}
    `.trim();
  }).join('\n');
  
  return {
    code,
    refs,
    comments: GenResultUtil.commentsFromSchemaObject(schema),
  };
};
export const generateForObjectSchema = (ctx: Context, schema: OpenApi.NonArraySchemaObject): GenResult => {
  const propSchemas: Record<string, OpenApiSchema> = schema.properties ?? {};
  
  let refs: GenResult['refs'] = [];
  
  const code = ((): string => {
    let code = '';
    if (Object.keys(propSchemas).length === 0) {
      const additionalPropSchema = schema.additionalProperties;
      if (typeof additionalPropSchema === 'undefined') {
        code = `S.Struct({})`;
      } else if (additionalPropSchema === true) {
        code = `S.Record(S.String, S.Unknown())`;
      } else if (additionalPropSchema === false) {
        code = `S.Record(S.Never, S.Never)`;
      } else {
        const additionalPropsResult = generateForSchema(ctx, additionalPropSchema);
        refs = GenResultUtil.combineRefs(refs, additionalPropsResult.refs);
        // TODO: also include the `comments` from `additionalPropsResult`?
        code = `S.Record(S.String, ${additionalPropsResult.code})`;
      }
    } else {
      let indexSignature = '';
      if (typeof schema.additionalProperties !== 'undefined') {
        if (schema.additionalProperties === false) {
          // No equivalent for this on a schema level, requires the consumer to use `onExcessProperty: "error"`
          // https://github.com/Effect-TS/effect/tree/main/packages/schema#strict
        } else if (schema.additionalProperties === true) {
          // No equivalent for this on a schema level, requires the consumer to use `onExcessProperty: "preserve"`
          // https://github.com/Effect-TS/effect/tree/main/packages/schema#passthrough
        } else {
          const additionalPropsResult = generateForSchema(ctx, schema.additionalProperties);
          refs = GenResultUtil.combineRefs(refs, additionalPropsResult.refs);
          
          // https://github.com/Effect-TS/effect/tree/main/packages/schema#index-signatures
          // TODO: also include the `comments` from `additionalPropsResult`?
          indexSignature = `{ key: S.String, value: ${additionalPropsResult.code} }`;
        }
      }
      
      const fieldsGen = generateFieldsForObjectSchema(ctx, schema);
      refs = GenResultUtil.combineRefs(refs, fieldsGen.refs);
      code = dedent`
        S.Struct({\n
          ${fieldsGen.code}
        }${indexSignature ? `, ${indexSignature}` : ''})
      `;
    }
    return code;
  })();
  
  return {
    code,
    refs,
    comments: GenResultUtil.commentsFromSchemaObject(schema),
  };
};

export const generateForArraySchema = (ctx: Context, schema: OpenApi.ArraySchemaObject): GenResult => {
  const itemSchema: OpenApiSchema = schema.items;
  const itemResult = generateForSchema(ctx, itemSchema);
  
  const code = ((): string => {
    let code = `S.Array(${itemResult.code})`;
    if (typeof schema.minLength === 'number') { code = `${code}.min(${schema.minLength})`; }
    if (typeof schema.maxLength === 'number') { code = `${code}.max(${schema.maxLength})`; }
    //if (schema.nullable) { code = `S.NullOr(${code})`; }
    return code;
  })();
  
  // FIXME: include the comments for `itemSchema` as well?
  return {
    code,
    refs: itemResult.refs,
    comments: GenResultUtil.commentsFromSchemaObject(schema),
  };
};

export const generateForReferenceObject = (ctx: Context, schema: OpenApi.ReferenceObject): GenResult => {
  // FIXME: make this logic customizable (allow a callback to resolve a `$ref` string to a `Ref` instance?)
  const matches = schema.$ref.match(/^#\/components\/schemas\/([a-zA-Z0-9_$]+)/);
  if (!matches) {
    throw new Error(`Reference format not supported: ${schema.$ref}`);
  }
  
  const schemaId = matches[1];
  if (typeof schemaId === 'undefined') { throw new Error('Should not happen'); }
  
  // If the referenced schema ID is topologically after the current one, wrap it in `S.suspend` for lazy eval
  const shouldSuspend = !ctx.isSchemaIdBefore(schemaId);
  const code = shouldSuspend ? `S.suspend((): S.Schema<_${schemaId}, _${schemaId}Encoded> => ${schemaId})` : schemaId;
  
  return { code, refs: [`./${schemaId}.ts`], comments: GenResultUtil.initComments() };
};

// Generate the @effect/schema code for the given OpenAPI schema
export const generateForSchema = (ctx: Context, schema: OpenApiSchema): GenResult => {
  const isNonArraySchemaType = (schema: OpenApiSchema): schema is OpenApi.NonArraySchemaObject => {
    return !('$ref' in schema) && (!('type' in schema) || !Array.isArray(schema.type));
  };
  
  if ('$ref' in schema) { // Case: OpenApi.ReferenceObject
    return generateForReferenceObject(ctx, schema);
  } else { // Case: OpenApi.SchemaObject
    if ('items' in schema && schema.type === 'array') { // Case: OpenApi.ArraySchemaObject
      return generateForArraySchema(ctx, schema);
    } else if (isNonArraySchemaType(schema)) { // Case: OpenApi.NonArraySchemaObject
      if ('allOf' in schema && typeof schema.allOf !== 'undefined') {
        const schemasHead: undefined | OpenApiSchema = schema.allOf[0];
        if (schemasHead && schema.allOf.length === 1) { // If only one schema, simply generate that schema
          return generateForSchema(ctx, schemasHead);
        }
        
        // `allOf` supports any type, but `@effect/schema` does not currently support generic intersections. Thus,
        // currently we only support `allOf` if it consists only of object schemas.
        // Idea: merge `allOf` schema first, e.g. using https://github.com/mokkabonna/json-schema-merge-allof
        const areAllObjects: boolean = schema.allOf.reduce(
          (acc, schema) => {
            if ('$ref' in schema) {
              return acc && isObjectSchema(ctx.schemas, schema.$ref);
            }
            
            const isObject = isNonArraySchemaType(schema) && schema.type === 'object';
            return acc && isObject;
          },
          true,
        );
        
        /*
        if (!areAllObjects) {
          throw new Error(dedent`
            Found \`allOf\` with a non-object schema. Currently only object schemas or unions of object schemas are
            supported.
          `);
        }
        */
        
        const schemas: Array<OpenApiSchema> = schema.allOf
          // Filter out empty schemas
          // XXX this only makes sense when all schemas are objects, would not work if we supported generic `allOf`
          .filter((schema: OpenApiSchema) => {
            if (!isNonArraySchemaType(schema) || schema.type !== 'object') { return true; }
            
            const props = schema.properties ?? {};
            if (Object.keys(props).length === 0 && !schema.additionalProperties) {
              return false;
            } else {
              return true;
            }
          });
        
        if (typeof schemasHead === 'undefined') {
          // XXX this only works for object schemas, as in `S.extend()`, would not work if we support generic `allOf`
          return generateForObjectSchema(ctx, { type: 'object' }); // Empty `allOf`
        } else if (schemas.length === 1) {
          // Trivial case: only one schema
          return generateForSchema(ctx, schemasHead);
        } else {
          let code = '';
          let schemasResults: Array<GenResult>;
          if (areAllObjects) {
            // Experimental: using `...MySchema.fields` to combine struct schemas.
            // Note: doesn't work if `MySchema` is a union of structs
            
            schemasResults = schemas.map(schema => {
              const genResult = generateForSchema(ctx, schema);
              if ('$ref' in schema) {
                genResult.code = `...${genResult.code}.fields,`;
              } else if (isNonArraySchemaType(schema)) {
                genResult.code = generateFieldsForObjectSchema(ctx, schema).code;
              }
              return genResult;
            });
            
            code = dedent`
              S.Struct({
                ${schemasResults
                  .map(({ code, comments }, index) => {
                    const commentsGenerated = GenResultUtil.commentsToCode(comments);
                    return dedent`
                      ${commentsGenerated.commentBlock}
                      ${commentsGenerated.commentInline}
                      ${code}
                    `.trim();
                  })
                  .join('\n')
                }
              })
            `;
          } else {
            schemasResults = schemas.map(schema => generateForSchema(ctx, schema));
            
            // Note: `extend` doesn't quite cover the semantics of `allOf`, since it only accepts objects and
            // assumes distinct types. However, @effect/schema has no generic built-in mechanism for this.
            code = dedent`
              pipe(
                ${schemasResults
                  .map(({ code, comments }, index) => {
                    const commentsGenerated = GenResultUtil.commentsToCode(comments);
                    return dedent`
                      ${commentsGenerated.commentBlock}
                      ${index > 0 ? `S.extend(${code})` : code}, ${commentsGenerated.commentInline}
                    `.trim();
                  })
                  .join('\n')
                }
              )
            `;
          }
          
          return {
            code,
            refs: GenResultUtil.combineRefs(schemasResults.flatMap(({ refs }) => refs)),
            comments: GenResultUtil.initComments(),
          };
        }
      } else if ('oneOf' in schema && typeof schema.oneOf !== 'undefined') {
        const schemas: Array<OpenApiSchema> = schema.oneOf;
        const schemasHead: undefined | OpenApiSchema = schemas[0];
        if (typeof schemasHead === 'undefined') {
          throw new TypeError(`oneOf must have at least one schema`);
        } else if (schemas.length === 1) {
          // Trivial case: only one schema
          return generateForSchema(ctx, schemasHead);
        } else {
          const schemasResults: Array<GenResult> = schemas.map(schema => generateForSchema(ctx, schema));
          // Note: `union` doesn't quite cover the semantics of `oneOf`, since `oneOf` must guarantee that exactly
          // one schema matches. However, @effect/schema has no easy built-in mechanism for this.
          const code = dedent`
            S.Union(
              ${schemasResults
                .map(({ code, comments }) => {
                  const commentsGenerated = GenResultUtil.commentsToCode(comments);
                  return dedent`
                    ${commentsGenerated.commentBlock}
                    ${code}, ${commentsGenerated.commentInline}
                  `.trim();
                })
                .join('\n')
              }
            )
          `;
          return {
            code,
            refs: GenResultUtil.combineRefs(schemasResults.map(({ refs }) => refs).flat()),
            comments: GenResultUtil.commentsFromSchemaObject(schema),
          };
        }
      } else if ('anyOf' in schema && typeof schema.anyOf !== 'undefined') {
        const schemas: Array<OpenApiSchema> = schema.anyOf;
        const schemasHead: undefined | OpenApiSchema = schemas[0];
        if (typeof schemasHead === 'undefined') {
          throw new TypeError(`anyOf must have at least one schema`);
        } else if (schemas.length === 1) {
          // Trivial case: only one schema
          return generateForSchema(ctx, schemasHead);
        } else {
          const schemasResults: Array<GenResult> = schemas.map(schema => generateForSchema(ctx, schema));
          const code = dedent`
            S.Union(
              ${schemasResults
                .map(({ code, comments }) => {
                  const commentsGenerated = GenResultUtil.commentsToCode(comments);
                  return dedent`
                    ${commentsGenerated.commentBlock}
                    ${code}, ${commentsGenerated.commentInline}
                  `;
                })
                .join('\n')
              }
            );
          `;
          return {
            code,
            refs: GenResultUtil.combineRefs(schemasResults.map(({ refs }) => refs).flat()),
            comments: GenResultUtil.commentsFromSchemaObject(schema),
          };
        }
      }
      
      type SchemaType = 'array' | OpenApi.NonArraySchemaObjectType;
      const type: undefined | OpenApi.NonArraySchemaObjectType | Array<SchemaType> = schema.type;
      
      if (typeof type === 'undefined') {
        throw new TypeError(`Missing 'type' in schema`);
      }
      
      const hookResult: null | GenResult = ctx.hooks.generateSchema?.(schema) ?? null;
      
      let result: GenResult;
      if (hookResult !== null) {
        result = hookResult;
      } else {
        switch (type) {
          case 'null': result = generateForNullSchema(ctx, schema); break;
          case 'string': result = generateForStringSchema(ctx, schema); break;
          case 'number': result = generateForNumberSchema(ctx, schema); break;
          case 'integer': result = generateForNumberSchema(ctx, schema); break;
          case 'boolean': result = generateForBooleanSchema(ctx, schema); break;
          case 'object': result = generateForObjectSchema(ctx, schema); break;
          default: throw new TypeError(`Unsupported type "${type}"`);
        }
      }
      return {
        ...result,
        code: `${result.code}`,
      };
    } else { // Case: OpenApi.MixedSchemaObject
      throw new Error(`Currently unsupported: MixedSchemaObject`);
    }
  }
};
