import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@lingban/api-sdk": path.resolve(__dirname, "../../packages/api-sdk/src/index.ts"),
      "@lingban/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@lingban/domain-models": path.resolve(__dirname, "../../packages/domain-models/src/index.ts"),
      "@lingban/ui-tokens": path.resolve(__dirname, "../../packages/ui-tokens/src/index.ts"),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("react-router")) {
            return "router-vendor";
          }

          if (id.includes("@tanstack/react-query") || id.includes("i18next") || id.includes("zustand")) {
            return "state-vendor";
          }

          if (
            id.includes(`${path.sep}react${path.sep}`) ||
            id.includes(`${path.sep}react-dom${path.sep}`) ||
            id.includes(`${path.sep}scheduler${path.sep}`)
          ) {
            return "react-vendor";
          }

          return "vendor";
        },
      },
    },
  },
});
