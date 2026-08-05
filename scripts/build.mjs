import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const config = { entry: "src/main.js", output: "src/main.js" };
const excluded = new Set([
  ".git",
  ".github",
  ".local",
  "dist",
  "node_modules",
  "scripts",
  "AGENTS.md",
  ".gitignore",
  "README.md",
  "package.json",
  "package-lock.json",
]);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (excluded.has(entry.name) || extname(entry.name) === ".js") continue;
  await cp(resolve(root, entry.name), resolve(dist, entry.name), {
    recursive: true,
    filter(source) {
      const rel = relative(root, source);
      if (!rel) return true;
      const parts = rel.split(sep);
      return !parts.some((part) => excluded.has(part)) && extname(source) !== ".js";
    },
  });
}

await build({
  entryPoints: [resolve(root, config.entry)],
  bundle: true,
  format: "esm",
  minify: true,
  platform: "browser",
  sourcemap: false,
  legalComments: "none",
  target: "es2020",
  outfile: resolve(dist, config.output),
});

console.log(`Built ${relative(root, dist)} for production.`);
