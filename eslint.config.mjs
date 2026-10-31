import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'data/', '_antigo/', '_audio_backup_wav/', 'audio/', 'tools/', 'scripts/'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error'
    }
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser }
  },
  {
    files: ['public/sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker }
  },
  {
    files: ['server/**/*.js', 'tests/**/*.js', 'eslint.config.mjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node }
  },
  {
    files: ['eslint.config.mjs'],
    languageOptions: { sourceType: 'module' }
  }
];
