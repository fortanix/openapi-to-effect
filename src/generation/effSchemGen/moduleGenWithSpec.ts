/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { dedent } from 'ts-dedent';
import * as path from 'node:path';
import { type OpenApiRef, type OpenApiSchemaId, type OpenApiSchema } from '../../util/openapi.ts';

import { refFromSchemaId, isObjectSchema } from '../../analysis/GraphAnalyzer.ts';
import * as GenSpec from '../generationSpec.ts';
import { type GenResult, GenResultUtil } from './genUtil.ts';
import { type Context as SchemaGenContext, generateForSchema } from './schemaGen.ts';


const assertUnreachable = (x: never): never => { throw new Error(`Should not happen`); };
const id = GenResultUtil.encodeIdentifier;


// Transform the given `schema` by reordering object fields according the given `ordering` spec.
// @throws TypeError When `schema` is not an object schema.
const reorderFields = (fieldGroups: GenSpec.FieldGroups, schema: OpenApiSchema): OpenApiSchema => {
  // We assume the `schema` is an object schema (or close enough to one). If `schema` is an allOf/oneOf/anyOf then
  // we reorder all of the possibilities.
  
  if ('$ref' in schema) { // Case: OpenAPIV3.ReferenceObject
    throw new TypeError(`Not an object schema`);
  } else { // Case: OpenAPIV3.SchemaObject
    if ('items' in schema) { // Case: OpenAPIV3.ArraySchemaObject
      throw new TypeError(`Not an object schema`);
    } else { // Case: OpenAPIV3.NonArraySchemaObject
      if ('allOf' in schema && typeof schema.allOf !== 'undefined') {
        return { ...schema, allOf: schema.allOf.map(schema => reorderFields(fieldGroups, schema)) };
      } else if ('oneOf' in schema && typeof schema.oneOf !== 'undefined') {
        return { ...schema, oneOf: schema.oneOf.map(schema => reorderFields(fieldGroups, schema)) };
      } else if ('anyOf' in schema && typeof schema.anyOf !== 'undefined') {
        return { ...schema, anyOf: schema.anyOf.map(schema => reorderFields(fieldGroups, schema)) };
      }
      
      if (schema.type !== 'object') {
        throw new TypeError(`Not an object schema`);
      }
      
      // Reorder `properties` (if any)
      // Note: we don't care about `required` or `additionalProperties` here
      
      const properties: undefined | Record<string, OpenApiSchema> = schema.properties;
      if (typeof properties === 'undefined') { return schema; }
      
      // Prep: get the list of all keys across all groups, for quick lookup purposes
      const orderingKeys: Array<string> = [...new Set(Object.values(fieldGroups).flatMap(fieldGroup => {
        // Each key may be a comma-separated string of field names
        return Object.keys(fieldGroup).flatMap(fieldNames => fieldNames.split(/,\s*/));
      }))];
      
      // FIXME
      // const groupHeadingComment: null | string = groupKey.startsWith('//')
      //   ? groupKey.replace('//', '').trim()
      //   : null;
      
      // Get a mapping of the initial fields in the group to the group name (for later annotation purposes)
      const orderingHeadings = Object.entries(fieldGroups).reduce(
        (acc, [fieldGroupKey, fieldGroup]) => {
          const fieldGroupNames = Object.keys(fieldGroup).flatMap(fieldNames => fieldNames.split(/,\s*/));
          
          // Get the first field in the list (this field will be annotated to identify where the group starts)
          const fieldInitial: undefined | string = fieldGroupNames[0];
          
          if (typeof fieldInitial === 'string') {
            acc[fieldInitial] = fieldGroupKey;
          }
          return acc;
        },
        {} as Record<string, string>,
      );
      
      return {
        ...schema,
        properties: Object.fromEntries(Object.entries(properties)
          .filter(([propKey]) => orderingKeys.includes(propKey))
          .sort(([prop1Key], [prop2Key]) => {
            return orderingKeys.indexOf(prop1Key) - orderingKeys.indexOf(prop2Key);
          })
          .map(([propKey, prop]) => {
            if (Object.hasOwn(orderingHeadings, propKey)) {
              return [propKey, { ...prop, 'x-heading': orderingHeadings[propKey] }];
            } else {
              return [propKey, prop];
            }
          }),
        ),
      };
    }
  }
};
const processSchemaWithSpec = (spec: GenSpec.GenerationDefinitionSpec, schema: OpenApiSchema): OpenApiSchema => {
  if (spec.action !== 'generate-schema') { return schema; }
  
  const fields: undefined | GenSpec.FieldGroups = spec.fields;
  if (typeof fields !== 'undefined') {
    return reorderFields(fields, schema);
  }
  
  return schema;
};

// Generate an @effect/schema module for the given module as per the given module spec
type GenerateModuleWithSpecOptions = {
  // Whether `schema1` is before `schema2` in the generation order
  isSchemaBefore: (schema1: OpenApiSchemaId, schema2: OpenApiSchemaId) => boolean,
};
export const generateModuleWithSpec = (
  schemas: Record<string, OpenApiSchema>, // All available source schemas (may contain ones we don't need)
  spec: GenSpec.GenerationSpec, // The (full) generation spec
  modulePath: GenSpec.ModulePath, // The specific module we want to generate
  options: GenerateModuleWithSpecOptions,
): string => {
  const generationContext: SchemaGenContext = {
    schemas,
    hooks: spec.hooks,
    isSchemaIdBefore: (schemaId: OpenApiSchemaId): boolean => {
      return true;
    },
  };
  
  const specModules = { ...spec.runtime, ...spec.modules };
  
  const moduleSpec: undefined | GenSpec.GenerationModuleSpec = specModules[modulePath];
  if (typeof moduleSpec === 'undefined') { throw new Error(`Cannot find definition for module ${modulePath}`); }
  
  // Derive the list of all schema IDs from `schemas`
  const schemaIds: Set<OpenApiSchemaId> = new Set(moduleSpec.definitions.map((def): OpenApiSchemaId => {
    return GenSpec.DefUtil.sourceSchemaIdFromDef(def);
  }));
  
  // Reverse mapping of schema IDs to the first definition that contains it
  type DefinitionLocator = { modulePath: GenSpec.ModulePath, definition: GenSpec.GenerationDefinitionSpec };
  const schemasToDefinitionsMap: Map<OpenApiSchemaId, DefinitionLocator> = new Map();
  for (const [modulePath, moduleSpec] of Object.entries(specModules)) {
    for (const definition of moduleSpec.definitions) {
      const schemaId = GenSpec.DefUtil.sourceSchemaIdFromDef(definition);
      if (!schemasToDefinitionsMap.has(schemaId)) {
        schemasToDefinitionsMap.set(schemaId, { modulePath, definition });
      }
    }
  }
  
  let codeExports = '';
  let refsModule: GenResult['refs'] = [];
  for (const definitionSpec of moduleSpec.definitions) {
    const targetSchemaId = GenSpec.DefUtil.targetSchemaIdFromDef(definitionSpec);
    
    const generationContextForSchema: SchemaGenContext = {
      ...generationContext,
      isSchemaIdBefore: (referencedSchemaId: OpenApiSchemaId): boolean => {
        return options.isSchemaBefore(referencedSchemaId, targetSchemaId);
        
        // const referencedDef = schemasToDefinitionsMap.get(referencedSchemaId);
        // if (!referencedDef) { return false; }
        // const defs = moduleSpec.definitions;
        // 
        // console.log('YYY', referencedSchemaId, '<-', targetSchemaId, referencedDef.definition);
        // if (defs.indexOf(referencedDef.definition) >= defs.indexOf(definitionSpec)) {
        //   console.log('XXX', referencedSchemaId, '>=', targetSchemaId);
        // }
        // 
        // return defs.indexOf(referencedDef.definition) < defs.indexOf(definitionSpec);
      },
    };
    
    switch (definitionSpec.action) {
      case 'custom-code': {
        codeExports = definitionSpec.code;
        break;
      };
      case 'custom-schema': {
        const schema: OpenApiSchema = definitionSpec.schema;
        const sourceSchemaId: OpenApiSchemaId = GenSpec.DefUtil.sourceSchemaIdFromDef(definitionSpec);
        
        const { code, refs, comments } = generateForSchema(generationContextForSchema, schema);
        const commentsGenerated = GenResultUtil.commentsToCode(comments);
        
        refsModule = GenResultUtil.combineRefs(refsModule, refs);
        
        const schemaExportComment: string = dedent`
          ${commentsGenerated.commentBlock}
          ${sourceSchemaId === targetSchemaId ? '' : `// Generated from OpenAPI \`${sourceSchemaId}\` schema`}
        `.trim();
        
        codeExports += '\n\n' + dedent`
          ${schemaExportComment ? `${schemaExportComment}\n` : ''}${
            typeof definitionSpec.typeDeclaration === 'string'
              //? `export const ${id(targetSchemaId)}: S.Schema<${id(targetSchemaId)}> = ` // Replaced with suspend annotations
              ? `export const ${id(targetSchemaId)} = `
              : `export const ${id(targetSchemaId)} = `
          }${
            //definitionSpec.lazy ? `S.suspend(() => ${code});` : code // Replaced with suspend annotations
            code
          }; ${commentsGenerated.commentInline}
        `.trim();
        if (typeof definitionSpec.typeDeclaration === 'string') {
          codeExports += dedent`
            export type ${id(targetSchemaId)} = ${definitionSpec.typeDeclaration};
          `;
        } else {
          codeExports += dedent`
            export type ${id(targetSchemaId)} = S.Schema.Type<typeof ${id(targetSchemaId)}>;
          `;
        }
        break;
      };
      case 'generate-schema': {
        const sourceSchemaId: OpenApiSchemaId = GenSpec.DefUtil.sourceSchemaIdFromDef(definitionSpec);
        const schemaRaw: undefined | OpenApiSchema = schemas[sourceSchemaId];
        if (!schemaRaw) { throw new Error(`Could not find a schema named ${sourceSchemaId}`) }
        const schema: OpenApiSchema = processSchemaWithSpec(definitionSpec, schemaRaw);
        
        const { code, refs, comments } = generateForSchema(generationContextForSchema, schema);
        const commentsGenerated = GenResultUtil.commentsToCode(comments);
        
        refsModule = GenResultUtil.combineRefs(refsModule, refs);
        
        
        // Start generating the schema exports
        codeExports += '\n\n';
        
        // Comments
        codeExports += dedent`
          /* ${id(targetSchemaId)} */
          ${commentsGenerated.commentBlock}
          ${sourceSchemaId === targetSchemaId ? '' : `// Generated from OpenAPI \`${sourceSchemaId}\` schema`}
        `.replace(/[\n]+/, '\n') + '\n';
        
        // Manual type declarations (for recursive references)
        if (typeof definitionSpec.typeDeclaration === 'string') {
          codeExports += `type _${id(targetSchemaId)} = ${definitionSpec.typeDeclaration};`;
          if (typeof definitionSpec.typeDeclarationEncoded === 'string') {
            codeExports += `type _${id(targetSchemaId)}Encoded = ${definitionSpec.typeDeclarationEncoded};`;
          }
        }
        /*
        const typeAnnotation = typeof definitionSpec.typeDeclaration === 'string'
          ? (
            typeof definitionSpec.typeDeclarationEncoded === 'string'
              ? `: S.Schema<_${id(targetSchemaId)}, _${id(targetSchemaId)}Encoded>`
              : `: S.Schema<_${id(targetSchemaId)}>`
          )
          : '';
        */
       const typeAnnotation = ''; // Replaced with suspend annotations
       
        const schemaCode = dedent`
          ${
            //definitionSpec.lazy ? `S.suspend(() => ${code})` : code // Replaced with suspend annotations
            code
          }
            .annotations({ identifier: ${JSON.stringify(targetSchemaId)} })
        `.trim();
        
        // See: https://github.com/Effect-TS/effect/tree/main/packages/schema#understanding-opaque-names
        const shouldGenerateOpaqueStruct = false;//isObjectSchema(schemas, refFromSchemaId(sourceSchemaId));
        const shouldGenerateOpaqueClass = false; //isObjectSchema(schemas, refFromSchemaId(sourceSchemaId)) && /^S.Struct/.test(code);
        if (shouldGenerateOpaqueStruct) {
          codeExports += dedent`
            const _${id(targetSchemaId)}${typeAnnotation} = ${schemaCode}; ${commentsGenerated.commentInline}
            export interface ${id(targetSchemaId)} extends S.Schema.Type<typeof _${id(targetSchemaId)}> {}
            export interface ${id(targetSchemaId)}Encoded extends S.Schema.Encoded<typeof _${id(targetSchemaId)}> {}
            export const ${id(targetSchemaId)}: S.Schema<${id(targetSchemaId)}, ${id(targetSchemaId)}Encoded> = _${id(targetSchemaId)};
          `.trim();
          /* To generate the runtime encoded schema:
            export const ${id(targetSchemaId)}Encoded: S.Schema<${id(targetSchemaId)}Encoded, ${id(targetSchemaId)}Encoded> =
              S.encodedSchema(_${id(targetSchemaId)});
          */
        } else if (shouldGenerateOpaqueClass) {
          // Experimental: generate a top level Struct as a class (for better opaque types)
          codeExports += dedent`
            export class ${id(targetSchemaId)} extends S.Class<${id(targetSchemaId)}>("${id(targetSchemaId)}")(
              ${code.replace(/^S\.Struct\(/, '').replace(/\),?$/, '')}
            ) {}
          `.trim();
        } else {
          codeExports += dedent`
            export const ${id(targetSchemaId)}${typeAnnotation} = ${schemaCode}; ${commentsGenerated.commentInline}
            export type ${id(targetSchemaId)} = S.Schema.Type<typeof ${id(targetSchemaId)}>;
            export type ${id(targetSchemaId)}Encoded = S.Schema.Encoded<typeof ${id(targetSchemaId)}>;
          `.trim();
          /* To generate the runtime encoded schema:
            export const ${id(targetSchemaId)}Encoded = S.encodedSchema(${id(targetSchemaId)});
          */
        }
        break;
      };
      default: assertUnreachable(definitionSpec);
    }
  }
  
  const refsSorted = [...refsModule]
    .filter(ref => {
      // Filter out imports that are already part of this file
      const importName = GenResultUtil.importNameFromRef(ref);
      return !schemaIds.has(importName);
    })
    .sort((ref1, ref2) => {
      // Sort certain imports at the top
      // FIXME: unhardcode this logic somehow
      if (ref1.includes('/util/')) {
        return -1;
      } else if (ref2.includes('/util/')) {
        return +1;
      }
      return 0;
    });
  
  const codeImports = dedent`
    ${refsSorted.map(ref => {
      const sourceSchemaId: OpenApiSchemaId = GenResultUtil.importNameFromRef(ref); // Get the source schema ID
      
      // Try to reverse-map this schema ID to one of the spec's definitions
      const definitionLocator: undefined | DefinitionLocator = schemasToDefinitionsMap.get(sourceSchemaId);
      
      if (typeof definitionLocator !== 'undefined') {
        const targetSchemaId = GenSpec.DefUtil.targetSchemaIdFromDef(definitionLocator.definition);
        
        // Calculate the relative path to the module
        let modulePathRelative = path.relative(path.dirname(modulePath), definitionLocator.modulePath);
        if (!modulePathRelative.startsWith('.')) { // Ensure the path starts with a `.` (ESM import paths require it)
          modulePathRelative = './' + modulePathRelative;
        }
        
        return `import { ${id(targetSchemaId)} } from '${modulePathRelative}';`;
      } else {
        return `// MISSING ${sourceSchemaId}`;
        //return `import { ${sourceSchemaId} } from '${ref}';`;
      }
    }).join('\n')}
  `;
  
  // TODO: may want to add a comment at the top like:
  //   /* Generated on ${new Date().toISOString()} from ${apiName} version ${apiVersion} */
  // Currently leaving this out because it means even simple changes cause a git diff upon regeneration.
  return dedent`
    import { pipe, Option } from 'effect';
    import { Schema as S } from '@effect/schema';
    
    ${codeImports}
    
    ${codeExports}
  `;
};
