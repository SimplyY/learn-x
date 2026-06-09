import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run("node", ["--check", "app/code/server.mjs"]);
run("node", ["--check", "app/code/public/app.js"]);
run("node", ["--check", "app/code/scripts/static-graph.mjs"]);
run("npm", ["run", "build"]);

console.log("Release check passed. Commit and push from the Learn-X root repository.");
