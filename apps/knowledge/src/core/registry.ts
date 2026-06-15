// Boot-time feature discovery. Recursively scans features/ for register.ts
// files, imports each, and calls its exported register(registry). The
// filesystem IS the registry — add a register.ts and it's picked up next boot;
// delete it and its surfaces vanish. (Pattern from task-builder; runs-from-source.)

import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createRegistry, type Registry, type RegistryState } from "./feature.ts";

const FEATURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "features");

async function findRegisterFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findRegisterFiles(full)));
    else if (entry.name === "register.ts") found.push(full);
  }
  return found.sort();
}

export async function loadRegistry(): Promise<RegistryState> {
  const { registry, state } = createRegistry();
  for (const file of await findRegisterFiles(FEATURES_DIR)) {
    const mod = (await import(pathToFileURL(file).href)) as { register?: (r: Registry) => void };
    if (typeof mod.register !== "function") {
      throw new Error(`${file}: a register.ts must export a register(registry) function`);
    }
    mod.register(registry);
  }
  return state;
}
