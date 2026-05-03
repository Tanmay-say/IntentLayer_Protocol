import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export function loadRootEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.DOTENV_CONFIG_PATH,
    join(process.cwd(), ".env"),
    join(here, "../../../.env"),
    join(here, "../../.env"),
  ].filter((value): value is string => Boolean(value));

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    dotenv.config({ path, override: false });
    return;
  }
}
