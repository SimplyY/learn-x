import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const message = process.argv.slice(2).join(" ").trim() || "Update Learn-X";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit"
  });

  if (result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }

  return result.stdout?.trim() || "";
}

function status(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe"
  }).status;
}

run("node", ["--check", "server.mjs"]);
run("node", ["--check", "public/app.js"]);
run("node", ["--check", "public/config.js"]);
run("npm", ["run", "snapshot"]);

const remote = run("git", ["remote", "get-url", "origin"], { capture: true });
if (!remote) {
  console.error("Missing git remote: run `git remote add origin <github-repo-url>` once before release.");
  process.exit(1);
}

run("git", ["add", "-A"]);

if (status("git", ["diff", "--cached", "--quiet"]) === 0) {
  console.log("No staged changes to commit.");
  process.exit(0);
}

run("git", ["commit", "-m", message]);
run("git", ["push", "-u", "origin", "HEAD"]);

console.log("Release pushed. GitHub Pages will deploy from the Pages workflow after the push.");
