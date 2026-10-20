import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Same "@" alias tsconfig.json gives the app — tests import with "@/...".
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "validate/**/*.test.ts",
      "parts/**/*.test.ts",
      "lib/**/*.test.ts",
      "mcp/**/*.test.ts",
    ],
  },
});
