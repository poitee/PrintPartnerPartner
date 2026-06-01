import type { FastifyInstance } from "fastify";
import type { AppRepository } from "../db/repository.js";
import {
  loadFleet,
  loadPrinterPresets,
  parsePrinterMachine,
  saveFleet,
} from "../services/printer-fleet.js";

type RouteDeps = { repo: AppRepository };

export async function registerPrinterRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/printers", async () => ({ printers: loadFleet(deps.repo) }));

  app.put("/printers", async (request, reply) => {
    const body = request.body as { printers?: Array<Record<string, unknown>> };
    const raw = body.printers ?? [];
    try {
      const fleet = raw.map((x) => parsePrinterMachine(x));
      saveFleet(deps.repo, fleet);
      return { printers: loadFleet(deps.repo) };
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/printers", async (request) => {
    const body = request.body as {
      name?: string;
      bed_width_mm?: number;
      bed_depth_mm?: number;
    };
    const fleet = loadFleet(deps.repo);
    const machine = parsePrinterMachine({
      id: `printer-${crypto.randomUUID().slice(0, 10)}`,
      name: body.name ?? "Printer",
      bed_width_mm: body.bed_width_mm ?? 250,
      bed_depth_mm: body.bed_depth_mm ?? 210,
      bed_height_mm: 250,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    });
    fleet.push(machine);
    saveFleet(deps.repo, fleet);
    return machine;
  });

  app.delete("/printers/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const fleet = loadFleet(deps.repo).filter((m) => m.id !== id);
    if (fleet.length === loadFleet(deps.repo).length) {
      return reply.status(404).send({ detail: "Printer not found" });
    }
    saveFleet(deps.repo, fleet);
    return reply.status(204).send();
  });

  app.get("/printer-presets", async () => ({ presets: loadPrinterPresets() }));
}
