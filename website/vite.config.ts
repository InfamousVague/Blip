import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: __dirname,
  base: "/Blip/",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.resolve(__dirname, "../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../node_modules/react-dom"),
      "@blip/ui": path.resolve(__dirname, "../src/ui"),
      "@blip/utils": path.resolve(__dirname, "../src/utils"),
      "@blip/map-themes": path.resolve(__dirname, "../src/map-themes.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5175,
  },
});
