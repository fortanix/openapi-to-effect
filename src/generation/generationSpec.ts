/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { type JSONPatchDocument } from 'immutable-json-patch';

import { type OpenAPIV3_1 as OpenAPIV3 } from 'openapi-types';
import { type OpenApiSchemaId, type OpenApiSchema } from '../util/openapi.ts';
import { type GenResult } from './effSchemGen/genUtil.ts';


const assertUnreachable = (x: never): never => { throw new Error(`Should not happen`); };


export type GenerationHooks = {
  generateSchema?: (schema: OpenApiSchema) => null | GenResult,
  generateStringType?: (schema: OpenAPIV3.NonArraySchemaObject) => null | GenResult,
  generateNumberType?: (schema: OpenAPIV3.NonArraySchemaObject) => null | GenResult,
  optionalFieldRepresentation?: undefined | 'nullish', // TEMP
};


// @effect/schema
export type EffectSchemaId = string;

export type FieldNames = string; // Comma-separated string of field names (identifiers)
export type FieldSpec = {
  default?: undefined | unknown,
};
export type FieldGroup = Record<FieldNames, FieldSpec>;
export type FieldGroups = Record<string, FieldGroup>;

export type ModulePath = string;
export type GenerationDefinitionSpec = (
  | {
    action: 'custom-code',
    schemaId: EffectSchemaId,
    code: string,
  }
  | {
    action: 'custom-schema',
    schemaId: EffectSchemaId,
    schema: OpenApiSchema,
    lazy?: undefined | boolean, // Whether we should wrap this in a `suspend()` call (for recursive references)
    typeDeclaration?: undefined | string, // Explicit type annotation (overrides inferred), usually used with `suspend`
    typeDeclarationEncoded?: undefined | string, // If specified, uses this as the "Encoded" type
  }
  | {
    action: 'generate-schema',
    sourceSchemaId?: undefined | OpenApiSchemaId,
    schemaId: EffectSchemaId,
    lazy?: undefined | boolean, // Whether we should wrap this in a `suspend()` call (for recursive references)
    typeDeclaration?: undefined | string, // Explicit type annotation (overrides inferred), usually used with `suspend`
    typeDeclarationEncoded?: undefined | string, // If specified, uses this as the "Encoded" type
    fields?: undefined | FieldGroups,
  }
);
export type GenerationModuleSpec = {
  definitions: Array<GenerationDefinitionSpec>,
};
export type GenerationSpec = {
  patch?: undefined | JSONPatchDocument, // A JSON Patch to apply on the OpenAPI document on initialization
  generationMethod: (
    | { method: 'one-to-one', generateBarrelFile?: undefined | boolean /* Default: false */ }
    | { method: 'bundled', bundleName: string }
    | { method: 'custom' }
  ),
  hooks: GenerationHooks,
  runtime: Record<ModulePath, GenerationModuleSpec>,
  modules: Record<ModulePath, GenerationModuleSpec>,
};


export const DefUtil = {
  sourceSchemaIdFromDef(def: GenerationDefinitionSpec): OpenApiSchemaId {
    switch (def.action) {
      case 'custom-code': return def.schemaId;
      case 'custom-schema': return def.schemaId;
      case 'generate-schema': return def.sourceSchemaId ?? def.schemaId;
      default: return assertUnreachable(def);
    }
  },
  targetSchemaIdFromDef(def: GenerationDefinitionSpec): EffectSchemaId {
    switch (def.action) {
      case 'custom-code': return def.schemaId;
      case 'custom-schema': return def.schemaId;
      case 'generate-schema': return def.schemaId;
      default: return assertUnreachable(def);
    }
  },
};
