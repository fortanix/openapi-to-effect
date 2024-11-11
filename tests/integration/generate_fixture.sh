#!/usr/bin/env bash
set -euo pipefail

# Get the path to the current directory (works in both bash and zsh)
# https://stackoverflow.com/a/54755784
PATH_CURRENT="$(dirname ${BASH_SOURCE[0]:-${(%):-%x}})"
cd $PATH_CURRENT

FIXTURE_NAME="${@:-1}"

# Note: do not use `npm run` here, because `npm run` always changes the working directory to that of the project root
generate() {
  node --import=tsx -- "../../src/openapiToEffect.ts" gen "$@"
}

TEST_SPEC_PATH="../fixtures/${FIXTURE_NAME}_spec.ts";
TEST_API_PATH="../fixtures/${FIXTURE_NAME}_api.json";
TEST_OUTPUT_PATH="../project_simulation/generated/${FIXTURE_NAME}";
mkdir -p "${TEST_OUTPUT_PATH}"
generate --spec="${TEST_SPEC_PATH}" "${TEST_API_PATH}" "${TEST_OUTPUT_PATH}"

echo
echo 'Generating sample file...'
cat <<"EOT" | FIXTURE_NAME="${FIXTURE_NAME}" node --import=tsx | npx --silent prettier --parser=babel-ts --single-quote > "${TEST_OUTPUT_PATH}/${FIXTURE_NAME}_sample.ts"
(async () => {
  const fixtureName = process.env.FIXTURE_NAME;
  const { dedent } = await import('ts-dedent');
  const S = await import('effect/Schema');
  const FastCheck = await import('effect/FastCheck');
  const Arbitrary = await import('effect/Arbitrary');
  const Fx = await import(`../project_simulation/generated/${fixtureName}/${fixtureName}.ts`);
  
  console.log(dedent`
    import { pipe, Schema as S, SchemaAST, FastCheck, Arbitrary } from 'effect';
    import * as Api from './${fixtureName}.ts';
  ` + '\n\n');
  
  const opts = { errors: 'all', onExcessProperty: 'ignore' };
  console.log(dedent`
    const opts: SchemaAST.ParseOptions = { errors: 'all', onExcessProperty: 'ignore' };
  ` + '\n\n');
  
  Object.entries(Fx)
    .filter(([name]) => !name.endsWith('Encoded'))
    .forEach(([name, Schema]) => {
      // Note: using `encodedSchema` here will not produce an input that can be decoded successfully. See:
      // https://discord.com/channels/795981131316985866/847382157861060618/threads/1237521922011431014
      //const sample = FastCheck.sample(Arbitrary.make(S.encodedSchema(Schema)), 1)[0];
      
      // Instead, we will sample an instance of the decoded type and then encode that
      const sample = FastCheck.sample(Arbitrary.make(Schema), 1)[0];
      const sampleEncoded = S.encodeSync(Schema, opts)(sample);
      
      console.log(dedent`
        const sample${name}: Api.${name} = pipe(
          ${JSON.stringify(sampleEncoded, null, 2)} as const satisfies S.Schema.Encoded<typeof Api.${name}>,
          S.decodeSync(Api.${name}, opts),
        );
      ` + '\n\n');
    });
})();
EOT
echo 'Done!'

node --import=tsx "${TEST_OUTPUT_PATH}/${FIXTURE_NAME}_sample.ts"


# Type check the output
# Note: no way to call `tsc` with a `tsconfig.json` while overriding the input file path dynamically, need to use
# a specialized `tsconfig.json` file that extends the base config.
npx --silent tsc --project tsconfig.json
