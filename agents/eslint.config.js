// NOTE: `pnpm run lint` currently cannot run in this package. typescript-eslint
// (as of 8.66.0) does not yet support TypeScript 7's native/Go compiler API --
// see https://github.com/typescript-eslint/typescript-eslint (issue closed as
// "not planned" for TS 7.0 GA; a stable programmatic API is expected in 7.1).
// This config is kept ready so `pnpm run lint` starts working the moment
// typescript-eslint or TS 7.1 lands support -- no changes needed here then.
// `pnpm run format`/`format:check` (Prettier) are unaffected and work today.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "data/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  eslintConfigPrettier,
);
