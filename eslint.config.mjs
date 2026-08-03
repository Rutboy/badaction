import { fixupConfigRules } from "@eslint/compat";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...fixupConfigRules(nextVitals),
  ...fixupConfigRules(nextTypescript),
  {
    // Next.js 16 enables new React compiler-oriented rules. Keep the existing
    // Next.js 15 lint baseline while ESLint itself moves to v10; these rules
    // can be adopted separately with the component refactors they require.
    rules: {
      "react-hooks/error-boundaries": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "next-env.d.ts",
    "node_modules/**",
    "*.tsbuildinfo",
  ]),
]);

export default eslintConfig;
