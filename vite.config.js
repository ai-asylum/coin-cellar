import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    open: false,
    hmr: false,
  },
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        lab: resolve(__dirname, "lab.html"),
        admin: resolve(__dirname, "admin/index.html"),
      },
    },
  },
});
