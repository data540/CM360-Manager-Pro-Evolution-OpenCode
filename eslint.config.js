import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      "react/jsx-uses-react": "error",
      "react/jsx-uses-vars": "error",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/exhaustive-deps": "warn",
      "no-empty": "warn",
      "react-hooks/set-state-in-effect": "off",
      "prefer-const": "warn",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**"],
  }
);
