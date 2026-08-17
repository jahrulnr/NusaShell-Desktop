import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const [version, root = "release-artifacts", output = join(root, "latest.json")] = process.argv.slice(2);
if (!version) throw new Error("Usage: node scripts/build-release-manifest.mjs <version> [root] [output]");

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }))).flat();
}

const manifest = { version, files: {} };
for (const path of await listFiles(root)) {
  const name = path.split(/[\\/]/).pop();
  let key;
  if (name === `nusashell-${version}-linux-x64.tar.gz`) key = "linux-x64";
  else if (name === `NusaShell-Desktop-win32-x64-${version}.zip`) key = "win32-x64";
  else {
    const match = name.match(/^NusaShell-Desktop-darwin-(x64|arm64)-(.+)\.zip$/);
    if (match?.[2] === version) key = `darwin-${match[1]}`;
  }
  if (!key) continue;
  manifest.files[key] = { name, sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
}
if (!Object.keys(manifest.files).length) throw new Error(`No release payloads found for ${version}`);
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${relative(process.cwd(), output)} for ${Object.keys(manifest.files).join(", ")}`);
