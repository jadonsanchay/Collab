import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import unusedImports from 'eslint-plugin-unused-imports';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends(
    'airbnb',
    'airbnb-typescript',
    'airbnb/hooks',
    'next/core-web-vitals',
    'next/typescript',
    'plugin:tailwindcss/recommended',
    'prettier',
  ),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      // Replaced by lucide-react and sonner in Step 7 of the Phase 1 roadmap;
      // this stops either from creeping back in.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-icons',
              message: 'Use lucide-react instead.',
            },
            {
              name: 'react-toastify',
              message: 'Use sonner instead.',
            },
          ],
          patterns: [
            {
              group: ['react-icons/*'],
              message: 'Use lucide-react instead.',
            },
          ],
        },
      ],
      // Airbnb's no-unused-vars is superseded by unused-imports above.
      '@typescript-eslint/no-unused-vars': 'off',
      // Path-aliased imports (@/common/..., @/modules/...) aren't resolvable by
      // eslint-plugin-import's default resolver without extra tsconfig-paths wiring.
      'import/no-unresolved': 'off',
      'import/prefer-default-export': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-props-no-spreading': 'off',
      // Every component in this codebase is an arrow function, not a function declaration.
      'react/function-component-definition': [
        'error',
        { namedComponents: 'arrow-function' },
      ],
      // A destructuring default (`hotkey = undefined`) is the idiomatic way to
      // mark an optional prop in a function component; Airbnb's PropTypes-era
      // version of this rule doesn't recognise that as satisfying it.
      'react/require-default-props': [
        'error',
        { functions: 'defaultArguments' },
      ],
    },
  },
  {
    // Tooling config and shared test helpers legitimately import
    // devDependencies. Airbnb's allowlist already covers `*.test.ts`, but not
    // root config files or the fixtures the tests share.
    files: ['*.config.ts', 'server/testing/**/*.ts'],
    rules: {
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
      // tailwind.config.ts is CommonJS (`module.exports`), so its plugin list
      // has to `require()` rather than mix in an ESM import.
      'global-require': 'off',
    },
  },
  {
    ignores: [
      '.next/**',
      'build/**',
      'node_modules/**',
      'eslint.config.mjs',
      'postcss.config.mjs',
    ],
  },
];

export default eslintConfig;
