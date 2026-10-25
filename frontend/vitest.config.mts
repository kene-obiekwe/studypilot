import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    // Same "@/" alias as tsconfig.json, so tests can import app code the way the app does.
    alias: [{ find: /^@\//, replacement: root }],
  },
});
