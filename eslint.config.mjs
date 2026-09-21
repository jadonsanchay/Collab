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
    },
  },
  {
    // Tooling config and shared test helpers legitimately import
    // devDependencies. Airbnb's allowlist already covers `*.test.ts`, but not
    // root config files or the fixtures the tests share.
    files: ['*.config.ts', 'server/testing/**/*.ts'],
    rules: {
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
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
