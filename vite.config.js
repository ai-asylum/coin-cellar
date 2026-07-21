import { defineConfig, loadEnv } from "vite";
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

// Dev-only persistence for the editor's dungeon tab (/editor.html): GET serves
// the saved tuning overrides, POST overwrites src/game/dungeon-tuning.json.
// dungeon-data.js imports that file and folds it over the code-defined tables at
// load, so a save is picked up by both the game and the editor on next reload.
function dungeonTuningApiPlugin() {
  const file = resolve(__dirname, "src/game/dungeon-tuning.json");
  return {
    name: "coin-cellar-dungeon-tuning-api",
    configureServer(server) {
      server.middlewares.use("/api/dungeon-tuning", async (req, res, next) => {
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
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("dungeon tuning must be a JSON object");
            }
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

// Dev-only persistence for the admin panel's combat-input settings (` key in
// game): GET serves the saved knobs, POST overwrites src/game/combat-settings.json.
// combat-settings.js imports that file and folds it over the code defaults at
// load, so a save is picked up by the game on its next reload.
function combatSettingsApiPlugin() {
  const file = resolve(__dirname, "src/game/combat-settings.json");
  return {
    name: "coin-cellar-combat-settings-api",
    configureServer(server) {
      server.middlewares.use("/api/combat-settings", async (req, res, next) => {
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
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("combat settings must be a JSON object");
            }
            if (typeof parsed.attackMode !== "string") {
              throw new Error("combat settings must include an attackMode string");
            }
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

// Local-only PostHog read proxy for the replay reviewer. The personal API key
// never enters browser code; Vite holds it and returns only matching events.
function replayPosthogApiPlugin(env) {
  return {
    name: "coin-cellar-replay-posthog-api",
    configureServer(server) {
      server.middlewares.use("/api/replay/posthog", async (req, res, next) => {
        if (req.method !== "POST") return next();
        res.setHeader("Content-Type", "application/json");
        const apiKey = env.POSTHOG_PERSONAL_API_KEY;
        const projectId = env.POSTHOG_PROJECT_ID;
        if (!apiKey || !projectId) {
          res.statusCode = 503;
          res.end(JSON.stringify({
            error: "Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID before starting Vite.",
          }));
          return;
        }
        try {
          let raw = "";
          for await (const chunk of req) raw += chunk;
          const testerId = JSON.parse(raw || "{}").tester_id;
          if (!/^#[0-9A-F]{8}$/i.test(testerId || "")) {
            throw new Error("tester_id must look like #00000000");
          }
          const events = [
            "playtest_id_shown", "player_position_batch", "game_started",
            "dungeon_entered", "returned_home", "item_sold", "ftue_step",
            "ftue_completed", "npc_talk",
          ];
          const eventList = events.map((event) => `'${event}'`).join(", ");
          const query = `SELECT timestamp, event, properties
            FROM events
            WHERE properties.tester_id = '${testerId.toUpperCase()}'
              AND event IN (${eventList})
            ORDER BY timestamp ASC
            LIMIT 20000`;
          const response = await fetch(
            `https://eu.posthog.com/api/projects/${encodeURIComponent(projectId)}/query/`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
            }
          );
          const data = await response.json();
          if (!response.ok) {
            res.statusCode = response.status;
            res.end(JSON.stringify({ error: data.detail || data.error || "PostHog query failed" }));
            return;
          }
          res.end(JSON.stringify({ columns: data.columns || [], results: data.results || [] }));
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: "./",
    server: {
      host: true,
      open: false,
      hmr: false,
    },
    plugins: [
      layoutApiPlugin(),
      dungeonTuningApiPlugin(),
      combatSettingsApiPlugin(),
      replayPosthogApiPlugin(env),
    ],
    build: {
      target: "es2020",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          lab: resolve(__dirname, "lab.html"),
          admin: resolve(__dirname, "admin/index.html"),
          editor: resolve(__dirname, "editor.html"),
          cooking: resolve(__dirname, "cooking.html"),
        },
      },
    },
  };
});
