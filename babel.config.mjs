
const target = process.env.BABEL_ENV;
export default {
  targets: {
    node: '20',
  },
  sourceMaps: true,
  presets: [
    '@babel/typescript',
    ['@babel/env', {
      // Do not include polyfills automatically. Leave it up to the consumer to include the right polyfills
      // for their required environment.
      useBuiltIns: false,
      
      // Whether to transpile modules
      modules: target === 'cjs' ? 'commonjs' : false,
    }],
  ],
  plugins: [
    ['replace-import-extension', { 'extMapping': { '.ts': target === 'cjs' ? '.cjs' : '.mjs' }}]
  ],
};
