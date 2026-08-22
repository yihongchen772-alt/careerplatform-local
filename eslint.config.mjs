import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "prisma/seed-companies.js",
    // Local-build additions: electron-builder's packaged output (a raw copy
    // of node_modules + the app, not source), and the Electron main process
    // itself — plain CommonJS Node, not part of the Next.js/TS app.
    "dist-electron/**",
    "electron/**",
  ]),
]);

export default eslintConfig;
