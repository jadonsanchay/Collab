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
    // Server has no logging library yet (tracked separately) — console is the
    // only startup/error output available, so allow it here specifically.
    files: ['server/**/*.ts'],
    rules: {
      'no-console': 'off',
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
