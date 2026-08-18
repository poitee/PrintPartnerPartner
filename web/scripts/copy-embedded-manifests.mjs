import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL("../apps/server/src/data/manifests/", import.meta.url),
);
const target = fileURLToPath(
  new URL("../apps/server/dist/data/manifests/", import.meta.url),
);

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

console.log(`Copied embedded manifests from ${source} to ${target}`);
