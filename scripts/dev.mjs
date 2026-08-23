import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const bundledPython = join(
  process.env.USERPROFILE ?? "",
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe",
);

const pythonCandidates = [
  process.env.PYTHON,
  existsSync(bundledPython) ? bundledPython : undefined,
  "python",
  "py",
].filter(Boolean);

function parseEnvFile(path) {
  if (!existsSync(path)) return {};

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const rawValue = line.slice(separator + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, "");
        return [key, value];
      }),
  );
}

const localEnv = parseEnvFile(join(root, ".env.local"));
const childEnv = { ...process.env, ...localEnv };
if (childEnv.ADMIN_PIN && !childEnv.VITE_ADMIN_PIN) {
  childEnv.VITE_ADMIN_PIN = childEnv.ADMIN_PIN;
}

function run(command, args, label) {
  const child = spawn(command, args, {
    cwd: root,
    env: childEnv,
    shell: command.endsWith(".cmd"),
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return child;
}

async function findPython() {
  for (const candidate of pythonCandidates) {
    const child = spawn(candidate, ["--version"], { shell: false });
    const ok = await new Promise((resolve) => {
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
    if (ok) return candidate;
  }

  throw new Error("No encontre Python. Instala Python 3.11+ o define la variable PYTHON.");
}

const python = await findPython();
const api = run(python, ["server.py"], "api");
const web = run("npm.cmd", ["run", "dev:web", "--", "--port", "5173"], "web");

function shutdown() {
  api.kill();
  web.kill();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

api.on("exit", (code) => {
  if (code !== null && code !== 0) {
    console.error(`[api] salio con codigo ${code}`);
    web.kill();
    process.exit(code);
  }
});

web.on("exit", (code) => {
  if (code !== null && code !== 0) {
    console.error(`[web] salio con codigo ${code}`);
    api.kill();
    process.exit(code);
  }
});
