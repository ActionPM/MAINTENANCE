import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  { ignores: ['**/dist/', '**/node_modules/', '**/.next/', '**/coverage/'] },

  // Base JS rules
  js.configs.recommended,

  // TypeScript rules for all TS files
  ...tseslint.configs.recommended,

  // Project-wide rule overrides
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Node.js globals for all packages (process, console, require, __dirname, etc.)
  // Required because flat config has no implicit `env` — without this, ESLint
  // reports "no-undef" on process.env, console.log, require(), etc.
  {
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Browser + Node globals for web app (Next.js SSR uses both)
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: { react: reactPlugin, 'react-hooks': reactHooksPlugin },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // React 19 auto-import
      'react/prop-types': 'off', // TypeScript handles this
    },
    settings: { react: { version: 'detect' } },
  },

  // Test globals (describe, it, expect, vi, etc.) + relaxed rules
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
    languageOptions: {
      globals: {
        ...globals.vitest,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Prettier must be last
  prettierConfig,
);
