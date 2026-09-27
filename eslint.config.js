import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['index.ts', 'src/**/*.ts'],
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use named exports.',
        },
      ],
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          enforceConst: true,
          ignore: [-1, 0, 1, 2, 3, 4, 10, 24, 60, 1000, 7000, 15000, 200, 201, 400, 403, 404, 413, 415, 500, 503],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreClassFieldInitialValues: true,
          ignoreNumericLiteralTypes: true,
        },
      ],
    },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/test-*.ts', 'src/prototype/**/*.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
);
