
[![npm](https://img.shields.io/npm/v/openapi-to-effect.svg?style=flat)](https://www.npmjs.com/package/openapi-to-effect)
[![GitHub Actions](https://github.com/fortanix/openapi-to-effect/actions/workflows/nodejs.yml/badge.svg)](https://github.com/fortanix/openapi-to-effect/actions)

# openapi-to-effect

Generate [@effect/schema](https://www.npmjs.com/package/@effect/schema) definitions from an [OpenAPI](https://www.openapis.org) document.

Note that `@effect/schema` is currently in pre-stable version, and thus there will likely be breaking changes in the future.

**Features:**

- All output is TypeScript code.
- Fully configurable using a spec file, including hooks to customize the output (e.g. support more `format`s).
- Automatic detection of recursive definitions using graph analysis. In the output, the recursive references are wrapped in `Schema.suspend()`.
- Supports generating either one file per schema, or all schemas bundled into one file. When bundled, the schemas are sorted according to a topological sort algorithm so that schema dependencies are reflected in the output order.
- Pretty printing using `prettier`. Descriptions in the schema (e.g. `title`, `description`) are output as comments in the generated code. `title` fields are assumed to be single line comments, which are output as `//` comments, whereas `description` results in a block comment.

**Limitations:**

- We currently only support [OpenAPI v3.1](https://spec.openapis.org/oas/latest.html) documents.
- Only JSON is supported for the OpenAPI document format. For other formats like YAML, run it through a [converter](https://onlineyamltools.com/convert-yaml-to-json) first.
- The input must be a single OpenAPI document. Cross-document [references](https://swagger.io/docs/specification/using-ref/) are not currently supported.
- The `$allOf` operator currently only supports schemas of type `object`. Generic intersections are not currently supported.

## Usage

This package exposes an `openapi-to-effect` command:

```console
npx openapi-to-effect <command> <args>
```

### Generating `@effect/schema` code with the `gen` command

The `gen` command takes the path to an OpenAPI v3.1 document (in JSON format), the path to the output directory, and optionally a spec file to configure the output:

```console
npx openapi-to-effect gen ./api.json ./output --spec=./spec.ts
```

### Example

```console
npx openapi-to-effect gen ./api.json ./output --spec=./spec.ts
```

**api.json**

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Example API",
    "version": "0.1.0"
  },
  "components": {
    "schemas": {
      "Category": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "subcategories": {
            "type": "object",
            "additionalProperties": {
              "$ref": "#/components/schemas/Category"
            },
            "default": {}
          }
        },
        "required": ["name"]
      },
      "User": {
        "type": "object",
        "properties": {
          "id": {
            "title": "Unique ID",
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "title": "The user's full name.",
            "type": "string"
          },
          "last_logged_in": {
            "title": "When the user last logged in.",
            "type": "string", "format": "date-time"
          },
          "role": {
            "title": "The user's role within the system.",
            "description": "Roles:\n- ADMIN: Administrative permissions\n- USER: Normal permissions\n- AUDITOR: Read only permissions",
            "type": "string",
            "enum": ["ADMIN", "USER", "AUDITOR"]
          },
          "posts": {
            "type": "array",
            "items": { "$ref": "#/components/schemas/Post" }
          }
        },
        "required": ["name", "last_logged_in", "role"]
      }
    }
  }
}
```

**spec.ts**

```ts
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
            readonly subcategories?: undefined | { readonly [key: string]: _CategoryEncoded }
          }`,
          typeDeclaration: `{
            readonly name: string,
            readonly subcategories: { readonly [key: string]: _Category }
          }`,
        },
      ],
    },
  },
} satisfies GenerationSpec;
```

**Output**

```ts
import { Schema as S } from '@effect/schema';

/* Category */

type _Category = {
  readonly name: string;
  readonly subcategories: { readonly [key: string]: _Category };
};
type _CategoryEncoded = {
  readonly name: string;
  readonly subcategories?: undefined | { readonly [key: string]: _CategoryEncoded };
};
export const Category = S.Struct({
  name: S.String,
  subcategories: S.optional(
    S.Record(
      S.String,
      S.suspend((): S.Schema<_Category, _CategoryEncoded> => Category),
    ),
    {
      default: () => ({}),
    },
  ),
}).annotations({ identifier: 'Category' });
export type Category = S.Schema.Type<typeof Category>;
export type CategoryEncoded = S.Schema.Encoded<typeof Category>;

/* User */

export const User = S.Struct({
  id: S.optional(S.UUID), // Unique ID
  name: S.String, // The user's full name.
  last_logged_in: S.Date, // When the user last logged in.
  /**
   * Roles:
   *
   * - ADMIN: Administrative permissions
   * - USER: Normal permissions
   * - AUDITOR: Read only permissions
   */
  role: S.Literal('ADMIN', 'USER', 'AUDITOR'), // The user's role within the system.
  interests: S.optional(S.Array(Category), {
    default: () => [],
  }),
}).annotations({ identifier: 'User' });
export type User = S.Schema.Type<typeof User>;
export type UserEncoded = S.Schema.Encoded<typeof User>;
```


## Contributing

We gratefully accept bug reports and contributions from the community.
By participating in this community, you agree to abide by [Code of Conduct](./CODE_OF_CONDUCT.md).
All contributions are covered under the Developer's Certificate of Origin (DCO).

### Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
have the right to submit it under the open source license
indicated in the file; or

(b) The contribution is based upon previous work that, to the best
of my knowledge, is covered under an appropriate open source
license and I have the right under that license to submit that
work with modifications, whether created in whole or in part
by me, under the same open source license (unless I am
permitted to submit under a different license), as indicated
in the file; or

(c) The contribution was provided directly to me by some other
person who certified (a), (b) or (c) and I have not modified
it.

(d) I understand and agree that this project and the contribution
are public and that a record of the contribution (including all
personal information I submit with it, including my sign-off) is
maintained indefinitely and may be redistributed consistent with
this project or the open source license(s) involved.

## License

This project is primarily distributed under the terms of the Mozilla Public License (MPL) 2.0, see [LICENSE](./LICENSE) for details.
