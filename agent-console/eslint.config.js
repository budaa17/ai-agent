import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "data/**",
      "src/api/generated.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      "@typescript-eslint/no-explicit-any": "warn",

      "no-empty": [
        "error",
        {
          allowEmptyCatch: true,
        },
      ],

      // Одоогийн existing кодыг CI дээр унагаахгүй.
      // Дараа нь use-document-meta.ts кодыг цэвэрлэж болно.
      "no-useless-assignment": "warn",
    },
  },

  // Browser environment ашигладаг файлууд
  {
    files: [
      "src/**/*.{ts,tsx}",
      "public/**/*.js",
      "scripts/browser-smoke.mjs",
      "scripts/marketing-audit.mjs",
      "scripts/platform-browser-audit.mjs",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Service Worker
  {
    files: ["pwa/sw.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },

  // React
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Existing pages use effects to sync URL/query state.
      // Warning болгон үлдээнэ, CI-г error болгож унагаахгүй.
      "react-hooks/set-state-in-effect": "warn",

      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
        },
      ],
    },
  },

  eslintConfigPrettier,
);