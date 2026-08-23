import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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

export default defineConfig(({ command }) => {
  if (command === "serve") {
    const localEnv = parseEnvFile(join(process.cwd(), ".env.local"));
    if (localEnv.ADMIN_PIN && !process.env.VITE_ADMIN_PIN) {
      process.env.VITE_ADMIN_PIN = localEnv.ADMIN_PIN;
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": "http://127.0.0.1:8000",
      },
    },
  };
});
