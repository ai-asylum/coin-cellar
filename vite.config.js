import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

// Dev-only persistence for the overworld editor (/editor.html): GET serves the
// current layout, POST overwrites src/game/layout.json (pretty-printed, so the
// diff stays reviewable). The game statically imports that file, so a save is
// picked up by the game on its next reload; the editor itself fetches through
// this endpoint and stays out of the JSON's module graph (see layout-store.js).
function layoutApiPlugin() {
  const file = resolve(__dirname, "src/game/layout.json");
  return {
    name: "coin-cellar-layout-api",
    configureServer(server) {
      server.middlewares.use("/api/layout", async (req, res, next) => {
        if (req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(await readFile(file, "utf-8"));
          return;
        }
        if (req.method === "POST") {
          try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const parsed = JSON.parse(body);
            for (const key of ["tables", "lots", "decor"]) {
              if (!Array.isArray(parsed[key])) throw new Error(`layout JSON must include a ${key} array`);
            }
            if (!parsed.fancy || typeof parsed.fancy !== "object") throw new Error("layout JSON must include a fancy table");
            await writeFile(file, JSON.stringify(parsed, null, 2) + "\n");
            res.statusCode = 204;
            res.end();
          } catch (err) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: "./",
  server: {
    host: true,
    open: false,
    hmr: false,
  },
  plugins: [layoutApiPlugin()],
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        lab: resolve(__dirname, "lab.html"),
        admin: resolve(__dirname, "admin/index.html"),
        editor: resolve(__dirname, "editor.html"),
      },
    },
  },
});
