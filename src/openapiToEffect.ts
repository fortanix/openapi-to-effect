/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { dedent } from 'ts-dedent';
import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Stats } from 'node:fs';
import * as fs from 'node:fs/promises';

import { type OpenAPIV3_1 as OpenApi } from 'openapi-types';
import { type OpenApiSchemaId, type OpenApiSchema } from './util/openapi.ts';

import * as GenSpec from './generation/generationSpec.ts';
import { generateModule } from './generation/effSchemGen/moduleGen.ts';
import { generateModuleWithSpec } from './generation/effSchemGen/moduleGenWithSpec.ts';
import { formatGeneratedCode } from './generation/formatting.ts';
import { type JSONPatchDocument, immutableJSONPatch } from 'immutable-json-patch';
import { schemaIdFromRef, topologicalSort, dependencyTree } from './analysis/GraphAnalyzer.ts';


// To use a directory path as a base URL in `new URL(<path>, <base>)` we need to ensure it has a trailing slash,
// otherwise the path will be relative to the parent directory.
const ensureTrailingSlash = (path: string) => path.replace(/[/]+$/, '') + '/';

const cwd: URL = pathToFileURL(ensureTrailingSlash(process.cwd())); // Trailing slash so we can use it as a base URL


type ConsoleService = Pick<Console, 'info' | 'error' | 'log'>;

// Parse an OpenAPI v3.1 document (in JSON format).
// @throws Error[code=ENOENT] When the document cannot be read.
// @throws SyntaxError When the document is not a valid OpenAPI v3.1 JSON document.
const parseDocument = async (documentUrl: URL): Promise<OpenApi.Document> => {
  const content: string = await fs.readFile(documentUrl, 'utf8');
  
  const contentJson = ((): unknown => {
    try {
      return JSON.parse(content);
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        throw error;
      } else {
        throw new Error(`Unable to parse JSON`, { cause: error }); // Unexpected error
      }
    }
  })();
  
  // Some quick sanity checks
  const isDocument = typeof contentJson === 'object' && contentJson !== null && 'openapi' in contentJson;
  if (!isDocument) { throw new SyntaxError('Not a valid OpenAPI document'); }
  if (typeof contentJson.openapi !== 'string' || !contentJson.openapi.trim().startsWith('3.1')) {
    const documentVersion = typeof contentJson.openapi !== 'string' ? contentJson.openapi : '(unknown version)';
    throw new SyntaxError(`Expected OpenAPI version 3.1, but got version '${documentVersion}'`);
  }
  
  // Note: we assume that this is a valid instance of `OpenApi.Document`
  // We may want to do some proper runtime validation here (but this can be expensive since the document may be large)
  return contentJson as any as OpenApi.Document; // (!) Unsafe cast
};


export type GenerateRequest = {
  document: OpenApi.Document,
  spec: null | GenSpec.GenerationSpec,
  outputDirectory: URL,
};
type GenerateRequestWithSpec = GenerateRequest & { spec: GenSpec.GenerationSpec };

// Generate one module per schema (does not support a spec file)
export const generateSchemas = async (
  request: GenerateRequest,
  { logger }: { logger: ConsoleService },
): Promise<void> => {
  const { document, outputDirectory } = request;
  
  logger.info(`Generating schemas from document: ${document.info.title} ${document.info.version}`);
  
  const schemas: Record<OpenApiSchemaId, OpenApiSchema> = document.components?.schemas ?? {};
  
  for (const [schemaId, schema] of Object.entries(schemas)) {
    const outputUrl = new URL(`${schemaId}.ts`, outputDirectory);
    
    logger.info(`Generating schema: '${path.relative(process.cwd(), fileURLToPath(outputUrl))}'`);
    
    try {
      // Generate the effect-schema module code
      const generatedCode = ((): string => {
        try {
          return generateModule(schemaId, schema);
        } catch (error: unknown) {
          logger.error(`Unable to convert to effect-schema`);
          throw error;
        }
      })();
      
      // Format the generated code
      const generatedCodeFormatted = await (async (): Promise<string> => {
        try {
          return await formatGeneratedCode(generatedCode);
        } catch (error: unknown) {
          // Note: if we made a mistake in our code generation logic (and generate invalid syntax), it will usually
          // appear as an error here
          logger.info(generatedCode);
          logger.error(`Unable to format code`);
          throw error;
        }
      })();
      
      // Write to the output file
      try {
        await fs.writeFile(outputUrl, generatedCodeFormatted, 'utf-8');
      } catch (error: unknown) {
        logger.error(`Failed to write to file: '${fileURLToPath(outputUrl)}'`);
        throw error;
      }
    } catch (error: unknown) {
      // If anything fails, just print the error and continue with the next schema
      logger.error(error);
    }
  }
};

// Generate schemas based on the given spec file
export const generateSchemasWithSpec = async (
  request: GenerateRequestWithSpec,
  { logger }: { logger: ConsoleService },
): Promise<void> => {
  const { document, spec, outputDirectory } = request;
  
  logger.info(`Generating schemas from document: ${document.info.title} ${document.info.version}`);
  
  const schemas: Record<OpenApiSchemaId, OpenApiSchema> = document.components?.schemas ?? {};
  const schemasSorted = topologicalSort(document);
  
  const specParsed = ((): GenSpec.GenerationSpec => {
    if (spec.generationMethod.method === 'one-to-one') { // Autogenerate modules one-to-one (one file per schema)
      return {
        ...spec,
        modules: {
          // Add each schema in the OpenAPI document to the spec modules list, so as to be autogenerated
          ...Object.fromEntries(Object.keys(schemas)
            .map((schemaId: OpenApiSchemaId): [GenSpec.ModulePath, GenSpec.GenerationModuleSpec] => {
              return [`./${schemaId}.ts`, { definitions: [{ action: 'generate-schema', schemaId }] }];
            }),
          ),
          // Modules already in the spec can still override the default autogenerate directives.
          ...spec.modules,
        },
      };
    } else if (spec.generationMethod.method === 'bundled') { // Bundle everything into one file
      return {
        ...spec,
        modules: {
          ...Object.fromEntries(schemasSorted
            .map(({ ref, circularDependency }): [GenSpec.ModulePath, GenSpec.GenerationModuleSpec] => {
              const schemaId = schemaIdFromRef(ref);
              const def: GenSpec.GenerationDefinitionSpec = {
                ...(spec.modules[`./${schemaId}.ts`]?.definitions?.find(def => def.schemaId  === schemaId) ?? {}),
                action: 'generate-schema',
                schemaId,
                lazy: circularDependency,
              };
              return [`./${schemaId}.ts`, { definitions: [def] }];
            }),
          ),
        },
      };
    } else {
      return spec;
    }
  })();
  
  let bundle = '';
  for (const [modulePath, _moduleSpec] of Object.entries({ ...specParsed.runtime, ...specParsed.modules })) {
    logger.info(`Generating module: ${modulePath}`);
    
    try {
      // Generate the effect-schema module code
      const generatedCode = ((): string => {
        try {
          return generateModuleWithSpec(schemas, specParsed, modulePath, {
            isSchemaBefore(schema1: OpenApiSchemaId, schema2: OpenApiSchemaId): boolean {
              if (spec.generationMethod.method !== 'bundled') { return true; }
              
              const schema1Index = schemasSorted.findIndex(({ ref }) => schemaIdFromRef(ref) === schema1);
              const schema2Index = schemasSorted.findIndex(({ ref }) => schemaIdFromRef(ref) === schema2);
              
              if (schema1Index === -1 || schema2Index === -1) {
                return true;
              }
              
              return schema1Index < schema2Index;
            },
          });
        } catch (error: unknown) {
          logger.error(`Unable to convert to effect-schema`);
          throw error;
        }
      })();
      
      // Format the generated code
      const generatedCodeFormatted = await (async (): Promise<string> => {
        try {
          return await formatGeneratedCode(generatedCode);
        } catch (error: unknown) {
          // Note: if we made a mistake in our code generation logic (and generate invalid syntax), it will usually
          // appear as an error here
          logger.info(generatedCode);
          logger.error(`Unable to format code`);
          throw error;
        }
      })();
      
      // Write to an output file
      const outputUrl = new URL(modulePath, outputDirectory);
      try {
        if (specParsed.generationMethod.method === 'bundled') {
          bundle += '\n\n' + generatedCodeFormatted;
        } else {
          await fs.mkdir(path.dirname(fileURLToPath(outputUrl)), { recursive: true });
          await fs.writeFile(outputUrl, generatedCodeFormatted, 'utf-8');
        }
      } catch (error: unknown) {
        logger.error(`Failed to write to file: ${outputUrl}`);
        throw error;
      }
    } catch (error: unknown) {
      if (specParsed.generationMethod.method === 'bundled') {
        throw error; // Stop bundling on first error
      } else {
        // If anything fails, just print the error and continue with the next schema
        logger.error('Error:', error);
      }
    }
  }
  
  if (specParsed.generationMethod.method === 'bundled') {
    const outputUrl = new URL(`${specParsed.generationMethod.bundleName}.ts`, outputDirectory);
    logger.info(`Writing to bundle: ${fileURLToPath(outputUrl)}`);
    
    try {
      const bundleFormatted = await formatGeneratedCode(
        dedent`
          /* Generated on ${new Date().toISOString()} from ${document.info.title} version ${document.info.version} */
          
          import { pipe, Option } from 'effect';
          import { Schema  as S } from '@effect/schema';
          
          ${bundle.replace(/(^|\n)(\s*)import [^;]+;(?! \/\/ <runtime>)/g, '')}
        `,
      );
      
      await fs.mkdir(path.dirname(fileURLToPath(outputUrl)), { recursive: true });
      await fs.writeFile(outputUrl, bundleFormatted, 'utf-8');
    } catch (error: unknown) {
      logger.error(`Failed to write to file: ${outputUrl}`);
      throw error;
    }
  }
  
  if (spec.generationMethod.method === 'one-to-one' && spec.generationMethod.generateBarrelFile) {
    // Generate a barrel file containing all exports
    let barrelContent = '';
    for (const [modulePath, moduleSpec] of Object.entries({ ...specParsed.runtime, ...specParsed.modules })) {
      barrelContent += `export * from '${modulePath}';\n`;
    }
    const barrelUrl = new URL('./index.ts', outputDirectory);
    logger.log(`Generating barrel file: ./index.ts`);
    await fs.writeFile(barrelUrl, barrelContent, 'utf-8');
  }
};


export type RequestInput = {
  documentPath: string,
  outputPath: string,
  specPath?: undefined | string,
};

// Parse the given input and return a valid `GenerateRequest` (or throw an error).
// @throws TypeError[ERR_INVALID_URL] If any of the given file paths are syntactically invalid.
export const parseRequest = async (
  { documentPath, outputPath, specPath }: RequestInput,
  { logger }: { logger: ConsoleService },
): Promise<GenerateRequest> => {
  // Note: the following could throw a `TypeError` exception if the paths are (syntactically) invalid, e.g. `//`
  const documentUrl = new URL(documentPath, cwd);
  const outputUrl = new URL(ensureTrailingSlash(outputPath), cwd); // Trailing slash for use as base URL
  const specUrl: null | URL = typeof specPath === 'undefined' ? null : new URL(specPath, cwd);
  
  // Check if the OpenAPI document exists
  try {
    await fs.stat(documentUrl);
  } catch (error: unknown) {
    throw new Error(`Provided OpenAPI file does not exist: '${documentPath}'`, { cause: error });
  }
  
  // Check if the output path exists and is a directory
  let outputUrlStats: Stats;
  try {
    outputUrlStats = await fs.stat(outputUrl);
  } catch (error: unknown) {
    throw new Error(`Provided output path does not exist: '${outputPath}'`, { cause: error });
  }
  if (!outputUrlStats.isDirectory()) {
    throw new Error(`Provided output path '${outputPath}' is not a directory`);
  }
  
  // Check if the generation spec file exists
  if (specUrl !== null) {
    try {
      await fs.stat(specUrl);
    } catch (error: unknown) {
      throw new Error(`Provided generation spec file does not exist: '${specPath}'`, { cause: error });
    }
  }
  
  // Load the generation spec
  const spec: null | GenSpec.GenerationSpec = specUrl === null ? null : (await import(specUrl.href)).default;
  
  // Load the OpenAPI document
  const document = await (async (): Promise<OpenApi.Document> => {
    try {
      return await parseDocument(documentUrl);
    } catch (error: unknown) {
      logger.error(`Unable to parse OpenAPI document: '${documentPath}'`);
      throw error;
    }
  })();
  
  // Apply JSON Patch (if any)
  const patch: null | JSONPatchDocument = spec !== null && Array.isArray(spec?.patch) ? spec.patch : null;
  const documentPatched = patch === null
    ? document
    : immutableJSONPatch<OpenApi.Document>(document, patch);
  
  return { document: documentPatched, outputDirectory: outputUrl, spec };
};


const printUsage = ({ logger }: { logger: ConsoleService }) => {
  logger.info(dedent`
    Usage: openapi-to-effect [-h | --help] [--silent] <command> [<args>]
    
    Commands:
      gen [--spec=<path>] <openapi-document-path> <output-path>
      analyze:dependency-tree <openapi-document-path> <root-schema-ref>
  `);
};

type ScriptArgs = {
  values: {
    help: boolean | undefined,
    spec: string | undefined,
  },
  positionals: Array<string>,
};

export const runGenerator = async (
  args: ScriptArgs,
  { logger }: { logger: ConsoleService },
): Promise<void> => {
  const documentPath: undefined | string = args.positionals[0];
  const outputPath: undefined | string = args.positionals[1];
  if (!documentPath || !outputPath) {
    printUsage({ logger });
    return;
  }
  
  const requestInput: RequestInput = {
    documentPath,
    outputPath,
    specPath: args.values.spec,
  };
  const request: GenerateRequest = await parseRequest(requestInput, { logger });
  
  if (request.spec === null) {
    await generateSchemas(request, { logger });
  } else {
    await generateSchemasWithSpec(request as GenerateRequestWithSpec, { logger });
  }
  
  logger.info('Done!');
};

// Example:
// `npm --silent run node src/openapiToEffect.ts analyze:dependency-tree tests/fixtures/fixture1_api.json\
//   '#/components/schemas/BatchRequest'`
export const runAnalyzeDependencyTree = async (
  args: ScriptArgs,
  { logger }: { logger: ConsoleService },
): Promise<void> => {
  const documentPath: undefined | string = args.positionals[0];
  const rootSchemaRef: undefined | string = args.positionals[1];
  if (!documentPath || !rootSchemaRef) {
    printUsage({ logger });
    return;
  }
  
  const documentUrl = new URL(documentPath, cwd);
  const document = await parseDocument(documentUrl);
  const tree = await dependencyTree(document, rootSchemaRef);
  
  logger.log(tree);
  
  logger.info('Done!');
};

// Run the script with the given CLI arguments
export const run = async (argsRaw: Array<string>): Promise<void> => {
  // Services
  const logger: ConsoleService = {
    info: console.info,
    error: console.error,
    log: console.log,
  };
  
  // Ref: https://exploringjs.com/nodejs-shell-scripting/ch_node-util-parseargs.html
  const args = parseArgs({
    args: argsRaw,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      silent: { type: 'boolean' },
      spec: { type: 'string' }, // Path to a spec file (optional)
      //runtime: { type: 'string' } // TODO: allow specifying a path to a "runtime" dir that we include in the output?
    },
  });
  
  if (args.values.silent) {
    logger.info = () => {};
  }
  
  const command: null | string = args.positionals[0] ?? null;
  if (command === null || args.values.help) {
    printUsage({ logger });
    return;
  }
  
  const argsForCommand = { ...args, positionals: args.positionals.slice(1) };
  switch (command) {
    case 'gen':
      await runGenerator(argsForCommand, { logger });
      break;
    case 'analyze:dependency-tree':
      await runAnalyzeDependencyTree(argsForCommand, { logger });
      break;
    default:
      logger.error(`Unknown command '${command}'\n`);
      printUsage({ logger });
      break;
  }
};

const [_argExec, argScript, ...args] = process.argv; // First two arguments should be the executable + script

// Detect if this module is being run directly from the command line
if (argScript && await fs.realpath(argScript) === fileURLToPath(import.meta.url)) {
  try {
    await run(args);
    process.exit(0);
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
