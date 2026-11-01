import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'test-results', 'playwright-report'] },
  ...tseslint.configs.recommended,
);
