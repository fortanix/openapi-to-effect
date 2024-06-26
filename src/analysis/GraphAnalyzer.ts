/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { type OpenAPIV3_1 as OpenApi } from 'openapi-types';
import { type OpenApiSchemaId, type OpenApiSchema, decodeJsonPointer, encodeJsonPointer } from '../util/openapi.ts';


//
// Reference resolving
//

type Ref = string; // OpenAPI schema reference
type Resolve = (ref: Ref) => OpenApiSchema; // Callback to take a ref and resolve it to the corresponding schema

export const schemaIdFromRef = (ref: Ref): OpenApiSchemaId => {
  const matches = ref.match(/^#\/components\/schemas\/.+/);
  if (!/^#\/components\/schemas\/.+/.test(ref)) {
    throw new Error(`Reference format not supported: ${ref}`);
  }
  
  const pointer = ref.replace(/^#/, '');
  const [refSchemaId, ...segments] = decodeJsonPointer(pointer).slice(2);
  if (typeof refSchemaId === 'undefined') { throw new Error('Should not happen'); }
  if (segments.length !== 0) { throw new Error(`Refs to nested paths not supported: ${ref}`); }
  
  return refSchemaId;
};
export const refFromSchemaId = (schemaId: OpenApiSchemaId): Ref => {
  return '#' + encodeJsonPointer(['components', 'schemas', schemaId]);
};

const resolver = (schemas: Record<OpenApiSchemaId, OpenApiSchema>) => (ref: string): OpenApiSchema => {
  const refSchemaId = schemaIdFromRef(ref);
  const refSchema = schemas[refSchemaId];
  if (typeof refSchema === 'undefined') { throw new Error('Should not happen'); }
  return refSchema;
};

// Get all direct (shallow) dependencies
const depsShallow = (schema: OpenApiSchema): Set<Ref> => {
  if ('$ref' in schema) { // Case: OpenApi.ReferenceObject
    return new Set([schema.$ref]);
  } else { // Case: OpenApi.SchemaObject
    if ('items' in schema) { // Case: OpenApi.ArraySchemaObject
      return depsShallow(schema.items);
    } else { // Case: OpenApi.NonArraySchemaObject
      if ('allOf' in schema && typeof schema.allOf !== 'undefined') {
        return new Set(schema.allOf.flatMap(subschema => [...depsShallow(subschema)]));
      } else if ('oneOf' in schema && typeof schema.oneOf !== 'undefined') {
        return new Set(schema.oneOf.flatMap(subschema => [...depsShallow(subschema)]));
      } else if ('anyOf' in schema && typeof schema.anyOf !== 'undefined') {
        return new Set(schema.anyOf.flatMap(subschema => [...depsShallow(subschema)]));
      }
      
      switch (schema.type) {
        case 'null':
        case 'string':
        case 'number':
        case 'integer':
        case 'boolean':
          return new Set();
        case 'object':
          const props: Record<OpenApiSchemaId, OpenApiSchema> = schema.properties ?? {};
          const additionalProps = schema.additionalProperties;
          const additionalPropsSchema: null | OpenApiSchema =
            typeof additionalProps === 'object' && additionalProps !== null
              ? additionalProps
              : null;
          return new Set([
            ...Object.values(props).flatMap(propSchema => [...depsShallow(propSchema)]),
            ...(additionalPropsSchema ? depsShallow(additionalPropsSchema) : []),
          ]);
        default: throw new TypeError(`Unsupported type ${JSON.stringify(schema.type)}`);
      }
    }
  }
};

// Get all dependencies for the given schema (as a dependency tree rooted at `schema`)
const depsDeep = (schema: OpenApiSchema, resolve: Resolve, visited: Set<Ref>): DepTree => {
  if ('$ref' in schema) { // Case: OpenApi.ReferenceObject
    if (visited.has(schema.$ref)) { return { [schema.$ref]: 'recurse' }; }
    return { [schema.$ref]: depsDeep(resolve(schema.$ref), resolve, new Set([...visited, schema.$ref])) };
  } else { // Case: OpenApi.SchemaObject
    if ('items' in schema) { // Case: OpenApi.ArraySchemaObject
      return depsDeep(schema.items, resolve, visited);
    } else { // Case: OpenApi.NonArraySchemaObject
      if ('allOf' in schema && typeof schema.allOf !== 'undefined') {
        return Object.assign({}, ...schema.allOf.flatMap(subschema => depsDeep(subschema, resolve, visited)));
      } else if ('oneOf' in schema && typeof schema.oneOf !== 'undefined') {
        return Object.assign({}, ...schema.oneOf.flatMap(subschema => depsDeep(subschema, resolve, visited)));
      } else if ('anyOf' in schema && typeof schema.anyOf !== 'undefined') {
        return Object.assign({}, ...schema.anyOf.flatMap(subschema => depsDeep(subschema, resolve, visited)));
      }
      
      switch (schema.type) {
        case 'null':
        case 'string':
        case 'number':
        case 'integer':
        case 'boolean':
          return {};
        case 'object':
          const props: Record<OpenApiSchemaId, OpenApiSchema> = schema.properties ?? {};
          const additionalProps = schema.additionalProperties;
          const additionalPropsSchema: null | OpenApiSchema =
            typeof additionalProps === 'object' && additionalProps !== null
              ? additionalProps
              : null;
          return Object.assign(
            {},
            ...Object.values(props).flatMap(propSchema => depsDeep(propSchema, resolve, visited)),
            additionalPropsSchema ? depsDeep(additionalPropsSchema, resolve, visited) : {},
          );
        default: throw new TypeError(`Unsupported type "${schema.type}"`);
      }
    }
  }
};


//
// Dependency trees
//

type DepTree = { [ref: Ref]: DepTree | 'recurse' };

// Create a dependency tree rooted at `rootRef`. If we find a cycle, inject a special "recurse" marker.
export const dependencyTree = (document: OpenApi.Document, rootSchemaRef: Ref): DepTree => {
  const schemas: Record<OpenApiSchemaId, OpenApiSchema> = document.components?.schemas ?? {};
  const rootSchemaId = schemaIdFromRef(rootSchemaRef);
  
  const rootSchema: undefined | OpenApiSchema = schemas[rootSchemaId];
  if (!rootSchema) { throw new Error(`Unable to find schema "${rootSchemaRef}"`); }
  
  return { [rootSchemaRef]: depsDeep(rootSchema, resolver(schemas), new Set([rootSchemaRef])) };
};


//
// Adjacency maps
//

type AdjacencyMap = Map<Ref, Set<Ref>>;

// Get a mapping from schemas to all of their direct dependencies
export const dependenciesMapFromDocument = (document: OpenApi.Document): AdjacencyMap => {
  const schemas: Record<OpenApiSchemaId, OpenApiSchema> = document.components?.schemas ?? {};
  
  // Mapping from a particular schema to its dependencies (directed neighbors in the graph: schema -> dependency)
  const dependenciesMap: AdjacencyMap = new Map<Ref, Set<Ref>>();
  
  for (const [schemaId, schema] of Object.entries(schemas)) {
    const schemaRef = refFromSchemaId(schemaId);
    const dependencies: Set<Ref> = depsShallow(schema);
    
    dependenciesMap.set(schemaRef, dependencies);
  }
  
  return dependenciesMap;
};

// Get a mapping from schemas to all of their direct dependents
export const dependentsMapFromDocument = (document: OpenApi.Document): AdjacencyMap => {
  const schemas: Record<OpenApiSchemaId, OpenApiSchema> = document.components?.schemas ?? {};
  
  // Mapping from a particular schema to its dependents (directed neighbors in the graph: schema <- dependent)
  const dependentsMap: AdjacencyMap = new Map<Ref, Set<Ref>>();
  
  for (const [schemaId, schema] of Object.entries(schemas)) {
    const schemaRef = refFromSchemaId(schemaId);
    const dependencies = ((): Set<Ref> => {
      try {
        return depsShallow(schema);
      } catch (error: unknown) {
        throw new Error(`Unable to determine dependents for '${schemaRef}'`, { cause: error });
      }
    })();
    
    for (const dependency of dependencies) {
      dependentsMap.set(dependency, new Set([
        ...(dependentsMap.get(dependency) ?? new Set()),
        schemaRef,
      ]));
    }
  }
  
  return dependentsMap;
};


//
// Topological sort
//

type TopologicalSort = Array<{
  ref: Ref,
  circularDependency: boolean, // If true, then this has at least one dependency that breaks the topological ordering
}>;
const topologicalSorter = (dependentsMap: AdjacencyMap) => {
  const visited = new Set<Ref>(); // Keep track of schemas we've already visited
  const refsWithCycles = new Set<Ref>(); // Keep track of schemas that have at least one circular dependency
  const sorted: TopologicalSort = [];
  
  const visit = (schemaRef: Ref): void => {
    if (visited.has(schemaRef)) {
      refsWithCycles.add(schemaRef);
      return;
    }
    
    visited.add(schemaRef);
    
    const dependents = dependentsMap.get(schemaRef) ?? new Set();
    for (const dependentSchemaRef of dependents) {
      visit(dependentSchemaRef);
    }
    
    sorted.unshift({ ref: schemaRef, circularDependency: refsWithCycles.has(schemaRef) });
  };
  
  return { visit, sorted };
};

export const topologicalSort = (document: OpenApi.Document): TopologicalSort => {
  const schemas: Record<OpenApiSchemaId, OpenApiSchema> = document.components?.schemas ?? {};
  
  const adjacency = dependentsMapFromDocument(document);
  const sorter = topologicalSorter(adjacency);
  
  for (const schemaId of Object.keys(schemas)) {
    const schemaRef = refFromSchemaId(schemaId);
    sorter.visit(schemaRef);
  }
  
  return sorter.sorted;
};


// Util: check if a given schema is an object schema
export class InfiniteRecursionError extends Error {}
const _isObjectSchema = (schema: OpenApiSchema, resolve: Resolve, visited: Set<Ref>): boolean => {
  if ('$ref' in schema) { // Case: OpenApi.ReferenceObject
    if (visited.has(schema.$ref)) {
      throw new InfiniteRecursionError(`Infinite recursion at ${schema.$ref}`);
    }
    return _isObjectSchema(resolve(schema.$ref), resolve, new Set([...visited, schema.$ref]));
  } else { // Case: OpenApi.SchemaObject
    if ('items' in schema) { // Case: OpenApi.ArraySchemaObject
      return _isObjectSchema(schema.items, resolve, visited);
    } else { // Case: OpenApi.NonArraySchemaObject
      if ('allOf' in schema && typeof schema.allOf !== 'undefined') {
        return schema.allOf.flatMap(subschema => _isObjectSchema(subschema, resolve, visited)).every(Boolean);
      } else if ('oneOf' in schema && typeof schema.oneOf !== 'undefined') {
        return false; // Union
      } else if ('anyOf' in schema && typeof schema.anyOf !== 'undefined') {
        return false; // Union
      }
      
      switch (schema.type) {
        case 'null':
        case 'string':
        case 'number':
        case 'integer':
        case 'boolean':
          return false;
        case 'object':
          return true;
        default: throw new TypeError(`Unsupported type "${schema.type}"`);
      }
    }
  }
};
export const isObjectSchema = (schemas: Record<OpenApiSchemaId, OpenApiSchema>, rootSchemaRef: Ref): boolean => {
  const rootSchemaId = schemaIdFromRef(rootSchemaRef);
  
  const rootSchema: undefined | OpenApiSchema = schemas[rootSchemaId];
  if (!rootSchema) { throw new Error(`Unable to find schema "${rootSchemaRef}"`); }
  
  return _isObjectSchema(rootSchema, resolver(schemas), new Set([rootSchemaRef]));
};
