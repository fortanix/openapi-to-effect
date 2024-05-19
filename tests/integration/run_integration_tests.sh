set -eu
if [ -z "$BASH" ]; then set -o pipefail; fi;

# Get the path to the current directory (works in both bash and zsh)
# https://stackoverflow.com/a/54755784
PATH_CURRENT="$(dirname ${BASH_SOURCE[0]:-${(%):-%x}})"

TEST_SPEC_PATH="${PATH_CURRENT}/../fixtures/fixture1_spec.ts";
TEST_API_PATH="${PATH_CURRENT}/../fixtures/fixture1_api.json";
TEST_OUTPUT_PATH="${PATH_CURRENT}/../project_simulation/generated/fixture1";
mkdir -p "${TEST_OUTPUT_PATH}"
npm run generate -- "--spec=${TEST_SPEC_PATH}" "${TEST_API_PATH}" "${TEST_OUTPUT_PATH}";


echo
echo 'Generating sample file...'
cat <<"EOT" | npm run --silent node | prettier --parser=babel-ts --single-quote > "${TEST_OUTPUT_PATH}/fixture1_sample.ts"
(async () => {
  const { dedent } = await import('ts-dedent');
  const S = await import('@effect/schema');
  const Fx = await import('./tests/project_simulation/generated/fixture1/fixture1.ts');
  
  console.log(dedent`
    import { pipe } from 'effect';
    import { Schema as S, AST } from '@effect/schema';
    import * as Api from './fixture1.ts';
  ` + '\n\n');
  
  const opts = { errors: 'all', onExcessProperty: 'ignore' };
  console.log(dedent`
    const opts: AST.ParseOptions = { errors: 'all', onExcessProperty: 'ignore' };
  ` + '\n\n');
  
  Object.entries(Fx)
    .filter(([name]) => !name.endsWith('Encoded'))
    .forEach(([name, Schema]) => {
      // Note: using `encodedSchema` here will not produce an input that can be decoded successfully. See:
      // https://discord.com/channels/795981131316985866/847382157861060618/threads/1237521922011431014
      //const sample = S.FastCheck.sample(S.Arbitrary.make(S.Schema.encodedSchema(Schema)), 1)[0];
      
      // Instead, we will sample an instance of the decoded type and then encode that
      const sample = S.FastCheck.sample(S.Arbitrary.make(Schema), 1)[0];
      const sampleEncoded = S.Schema.encodeSync(Schema, opts)(sample);
      
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

npm run node "${TEST_OUTPUT_PATH}/fixture1_sample.ts"


# Type check the output
# Note: no way to call `tsc` with a `tsconfig.json` while overriding the input file path dynamically, need to use
# a specialized `tsconfig.json` file that extends the base config.
tsc --project "${PATH_CURRENT}/tsconfig.json"
