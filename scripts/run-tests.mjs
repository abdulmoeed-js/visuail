// Runs every src/**/*.test.ts with Node's own test runner (node:test). The
// files are loaded through Vite, so TypeScript and the "@/" imports work as
// they do in the app, and nothing beyond what the app already installs is
// needed. Needs Node 22.12 or later (what Vite 8 needs).
//
//   npm test              every test file
//   npm test -- schema    only files whose path contains "schema"
//
// Import everything a test needs at the top of its file: the loader closes
// once every file has loaded, so an import() inside a test fails.

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filter = process.argv[2] ?? "";

async function findTests(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findTests(full)));
    else if (/\.test\.tsx?$/.test(entry.name) && full.includes(filter)) out.push(full);
  }
  return out;
}

const files = (await findTests(path.join(root, "src"))).sort();
if (files.length === 0) {
  console.error(`No test files${filter ? ` matching "${filter}"` : ""}.`);
  process.exit(1);
}

// Just the module loader: no app config, plugins, port or file watching.
const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  resolve: { alias: { "@": path.join(root, "src") } },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  // Each file registers its tests with node:test as it loads; they run and
  // report on their own, and a failure sets the exit code.
  for (const file of files) await server.ssrLoadModule(file);
} finally {
  await server.close();
}
