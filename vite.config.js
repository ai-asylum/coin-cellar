import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    open: false,
  },
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        lab: resolve(__dirname, "lab.html"),
      },
    },
  },
});
