import type { IntegrationAdapter } from "./store.js";
import { moonrakerAdapter } from "./adapters/moonraker.js";
import { prusalinkAdapter } from "./adapters/prusalink.js";
import { bambuAdapter } from "./adapters/bambu.js";
import { spoolmanAdapter } from "./adapters/spoolman.js";
import { slicerFolderAdapter } from "./adapters/slicer-folder.js";
import { aiAssistantAdapter } from "./adapters/ai-assistant.js";

const adapters: IntegrationAdapter[] = [
  moonrakerAdapter,
  prusalinkAdapter,
  bambuAdapter,
  spoolmanAdapter,
  slicerFolderAdapter,
  aiAssistantAdapter,
];

export function getIntegrationAdapter(type: string): IntegrationAdapter | undefined {
  return adapters.find((a) => a.type === type);
}

export function listIntegrationTypes(): string[] {
  return adapters.map((a) => a.type);
}
