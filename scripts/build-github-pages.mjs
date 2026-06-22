import { existsSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const projectRoot = process.cwd();
const appDir = join(projectRoot, "src", "app");
const apiDir = join(appDir, "api");
const disabledApiDir = join(appDir, "_api_disabled_for_pages");

process.env.GITHUB_PAGES ||= "true";
process.env.NEXT_PUBLIC_STATIC_EXPORT ||= "true";
process.env.NEXT_PUBLIC_MOCK_MODE ||= "true";
process.env.NEXT_PUBLIC_GITHUB_PAGES_BASE_PATH ||= "/RangeGuard";
process.env.MOCK_MODE ||= "true";

function disableApiRoutes() {
  if (!existsSync(apiDir)) return false;
  if (existsSync(disabledApiDir)) {
    throw new Error(`${disabledApiDir} already exists. Restore or remove it before building Pages.`);
  }

  renameSync(apiDir, disabledApiDir);
  return true;
}

function restoreApiRoutes(disabled) {
  if (!disabled) return;
  renameSync(disabledApiDir, apiDir);
}

function removeGeneratedBuildDir(name) {
  const target = resolve(projectRoot, name);
  if (!target.startsWith(`${projectRoot}\\`) && !target.startsWith(`${projectRoot}/`)) {
    throw new Error(`Refusing to remove ${target}; it is outside ${projectRoot}.`);
  }

  rmSync(target, { recursive: true, force: true });
}

const disabled = disableApiRoutes();

try {
  removeGeneratedBuildDir(".next");
  removeGeneratedBuildDir("out");

  const nextCli = join(projectRoot, "node_modules", "next", "dist", "bin", "next");
  const result = spawnSync(process.execPath, [nextCli, "build"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
} finally {
  restoreApiRoutes(disabled);
}
