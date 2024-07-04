
import { type GenerationSpec } from '../../src/generation/generationSpec.ts';


export default {
  generationMethod: { method: 'bundled', bundleName: 'fixture0' },
  hooks: {},
  runtime: {},
  modules: {
    './Category.ts': {
      definitions: [
        {
          action: 'generate-schema',
          schemaId: 'Category',
          typeDeclarationEncoded: `{
            readonly name: string,
            readonly description: null | string,
            readonly status?: undefined | null | 'ACTIVE' | 'DEPRIORITIZED',
            readonly subcategories?: undefined | { readonly [key: string]: _CategoryEncoded }
          }`,
          typeDeclaration: `{
            readonly name: string,
            readonly description: null | string,
            readonly status?: undefined | null | 'ACTIVE' | 'DEPRIORITIZED',
            readonly subcategories: { readonly [key: string]: _Category }
          }`,
        },
      ],
    },
  },
} satisfies GenerationSpec;
