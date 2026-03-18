import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** Regex patterns that flag forbidden vscode imports per layer. */
const NO_VSCODE_LAYERS = ["src/core/**/*.ts", "src/app/**/*.ts", "src/plugins/**/*.ts", "src/infra/**/*.ts"];

export default [
  // ── Ignore legacy code and build output ─────────────────────────────
  { ignores: ["src-legacy/**", "dist/**", "out/**"] },

  // ── Base config for all TS files ────────────────────────────────────
  {
    files: ["src/**/*.ts"],
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/naming-convention": ["warn", {
        selector: "import",
        format: ["camelCase", "PascalCase"],
      }],
      curly: "off",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "warn",
    },
  },

  // ── Layer boundary: no 'vscode' import in core/app/plugins/infra ───
  {
    files: NO_VSCODE_LAYERS,
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["vscode"],
          message: "Layer boundary violation: core/app/plugins/infra must not import 'vscode'. Use an injected interface from core/types/.",
        }],
      }],
    },
  },
];