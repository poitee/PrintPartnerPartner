# Printer Profile Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users assign a machine profile and per-slot filament profiles on each fleet printer, show last-synced time and compatible processes, drive auto-slice when “Use assigned profiles” is on, and remove the Export Profile library.

**Architecture:** New SQLite/Postgres tables store assignments keyed by fleet `printer_id`. Pure helpers compute last-synced and compatible processes. `resolveFlatConfigsForPrinter` honors assignments when `profile_source = assigned`, otherwise keeps today’s name-matching. Settings → Printers is the only assignment UI; Export drops `ProfileLibraryPanel`.

**Tech Stack:** TypeScript monorepo (`web/`), Vitest, Drizzle + SQLite/Postgres schema dual-write, Fastify routes, React settings UI.

**Spec:** `docs/superpowers/specs/2026-08-17-slicer-hub-profile-assignment-design.md` (Plan 1 / ship step 1 only).

**Deferred plans (do not implement here):**
- Plan 2 — Slicer instances (URLs + watch paths)
- Plan 3 — Docker lifecycle (local / pp_compose / remote)
- Plan 4 — Export plate → slicer handoff polish
- Later — Native slicer project export

## Global Constraints

- Preserve 3MF `object@name` = STL basename / `name (n)` — this plan must not change `export-3mf` naming.
- Schema version bump must land in both `schema.ts` and `schema-pg.ts` (+ Postgres post-init migrations), lockstep with `schema-v9.test.ts` patterns.
- Default `profile_source` for new/unconfigured printers: `auto_match` (no behavior change until the user opts in).
- When `profile_source = assigned` and machine profile is missing, auto-slice must fail with a clear warning/CTA — do not silently fall back to name match.
- Process profiles remain unpinned: still pick from compatible list via existing heuristic when assigned mode is on (filter candidates by compatibility with the assigned machine name when possible).
- Run Node commands from `web/`.
- YAGNI: no slicer instance table, no Docker APIs, no Export open-in changes in this plan.

## File map

| File | Responsibility |
|------|----------------|
| `web/apps/server/src/db/schema.ts` | SQLite Drizzle tables + migration SQL for v14 |
| `web/apps/server/src/db/schema-pg.ts` | Postgres Drizzle tables (same columns) |
| `web/apps/server/src/db/client-postgres.ts` | Postgres DDL for new tables if required by post-init pattern |
| `web/apps/server/src/db/schema-v9.test.ts` (or v14 companion) | Assert new tables/columns exist after migrate |
| `web/apps/server/src/services/printer-profile-assignments.ts` | Pure helpers + load/save orchestration types |
| `web/apps/server/src/services/printer-profile-assignments.test.ts` | Unit tests for helpers |
| `web/apps/server/src/db/repository.ts` | CRUD for assignment tables + profile lookups by id (incl. `lastSyncedAt`) |
| `web/apps/server/src/routes/printers.ts` | `GET/PUT /printers/:id/profile-assignment` |
| `web/apps/server/src/services/slicer-routing.ts` | Honor assignments in `resolveFlatConfigsForPrinter` |
| `web/apps/server/src/services/slicer-routing.test.ts` | Assigned vs auto_match cases |
| `web/apps/web/src/pages/ExportPage.tsx` | Remove Profile library |
| `web/apps/web/src/components/export/ProfileLibraryPanel.tsx` | Delete (or leave unused only if something else imports — prefer delete) |
| `web/apps/web/src/api/engine.ts` | Client fetch/save assignment + profile picker lists |
| `web/apps/web/src/components/settings/PrintersSettingsCard.tsx` | Assignment UI per printer |
| `docs/API.md` | Document new endpoints briefly |

---

### Task 1: Pure helpers — last synced + compatible processes

**Files:**
- Create: `web/apps/server/src/services/printer-profile-assignments.ts`
- Create: `web/apps/server/src/services/printer-profile-assignments.test.ts`

**Interfaces:**
- Produces:
  - `export type ProfileSourceMode = "assigned" | "auto_match"`
  - `export function latestSyncedAt(timestamps: Array<string | null | undefined>): string | null`
  - `export function processCompatibleWithMachine(compatiblePrintersJson: string | null | undefined, machineProfileName: string): boolean`
  - `export type PrinterProfileAssignmentView = { printer_id: string; profile_source: ProfileSourceMode; machine_profile_id: number | null; filament_slots: Array<{ slot_index: number; filament_profile_id: number | null }>; last_synced_at: string | null; compatible_processes: Array<{ id: number; name: string }> }`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  latestSyncedAt,
  processCompatibleWithMachine,
} from "./printer-profile-assignments.js";

describe("latestSyncedAt", () => {
  it("returns null when all missing", () => {
    expect(latestSyncedAt([null, undefined])).toBeNull();
  });
  it("returns the max ISO timestamp among assigned profiles", () => {
    expect(
      latestSyncedAt(["2024-08-17T17:11:00.000Z", null, "2024-08-18T12:00:00.000Z"]),
    ).toBe("2024-08-18T12:00:00.000Z");
  });
});

describe("processCompatibleWithMachine", () => {
  it("matches when machine name is listed (case-insensitive)", () => {
    expect(
      processCompatibleWithMachine(JSON.stringify(["Voron 350", "Other"]), "voron 350"),
    ).toBe(true);
  });
  it("matches bidirectional substring like existing name heuristics", () => {
    expect(processCompatibleWithMachine(JSON.stringify(["Voron 350 0.4"]), "Voron 350")).toBe(
      true,
    );
  });
  it("returns true when compatible list is empty/null (treat as unrestricted)", () => {
    expect(processCompatibleWithMachine(null, "Voron 350")).toBe(true);
    expect(processCompatibleWithMachine("[]", "Voron 350")).toBe(true);
  });
  it("returns false when list is non-empty and no name matches", () => {
    expect(processCompatibleWithMachine(JSON.stringify(["Bambu X1C"]), "Voron 350")).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd web && npx vitest run apps/server/src/services/printer-profile-assignments.test.ts`

Expected: FAIL (module/exports missing)

- [ ] **Step 3: Implement helpers**

```typescript
export type ProfileSourceMode = "assigned" | "auto_match";

export function latestSyncedAt(timestamps: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const raw of timestamps) {
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) continue;
    if (ms >= bestMs) {
      bestMs = ms;
      best = raw;
    }
  }
  return best;
}

function namesLooselyMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function processCompatibleWithMachine(
  compatiblePrintersJson: string | null | undefined,
  machineProfileName: string,
): boolean {
  if (!compatiblePrintersJson) return true;
  let list: unknown;
  try {
    list = JSON.parse(compatiblePrintersJson);
  } catch {
    return true;
  }
  if (!Array.isArray(list) || list.length === 0) return true;
  const names = list.map((x) => String(x ?? ""));
  return names.some((n) => namesLooselyMatch(n, machineProfileName));
}

export type PrinterProfileAssignmentView = {
  printer_id: string;
  profile_source: ProfileSourceMode;
  machine_profile_id: number | null;
  filament_slots: Array<{ slot_index: number; filament_profile_id: number | null }>;
  last_synced_at: string | null;
  compatible_processes: Array<{ id: number; name: string }>;
};
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd web && npx vitest run apps/server/src/services/printer-profile-assignments.test.ts`

- [ ] **Step 5: Commit**

```bash
git add web/apps/server/src/services/printer-profile-assignments.ts \
  web/apps/server/src/services/printer-profile-assignments.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add profile assignment helper utilities

Compute last-synced timestamps and process/machine compatibility for
per-printer profile assignment.
EOF
)"
```

---

### Task 2: Schema v14 — assignment tables

**Files:**
- Modify: `web/apps/server/src/db/schema.ts` (`currentSchemaVersion` 13 → 14; add tables + SQL migrations)
- Modify: `web/apps/server/src/db/schema-pg.ts` (same Drizzle tables)
- Modify: `web/apps/server/src/db/client-postgres.ts` (add CREATE TABLE IF NOT EXISTS for both tables in post-init migrations list, matching v9–v13 pattern)
- Modify: `web/apps/server/src/db/schema-v9.test.ts` (assert tables exist; bump version expectation to 14)

**Interfaces:**
- Produces tables:
  - `printer_profile_assignments(printer_id TEXT PK, tenant_id, machine_profile_id INT NULL, profile_source TEXT NOT NULL DEFAULT 'auto_match', updated_at TEXT NOT NULL)`
  - `printer_filament_slot_assignments(tenant_id, printer_id, slot_index INT, filament_profile_id INT NULL, UNIQUE(tenant_id, printer_id, slot_index))`

- [ ] **Step 1: Write failing schema assertion**

In `schema-v9.test.ts` (or extend the existing version lockstep test), add:

```typescript
const V14_TABLES = [
  "printer_profile_assignments",
  "printer_filament_slot_assignments",
];

// inside the SQLite migrate test:
for (const table of V14_TABLES) {
  expect(sqliteTableNames(sqlite)).toContain(table);
}
expect(
  rawSqlite(sqlite)
    .prepare("SELECT value FROM app_settings WHERE tenant_id = ? AND key = ?")
    .get("default", "schema_version") as { value: string },
).toMatchObject({ value: "14" });
```

Also update `currentSchemaVersion` lockstep test to expect `14` on both sqlite and pg exports.

- [ ] **Step 2: Run schema tests — expect FAIL**

Run: `cd web && npx vitest run apps/server/src/db/schema-v9.test.ts`

Expected: FAIL (version still 13 / tables missing)

- [ ] **Step 3: Add Drizzle tables + migrations**

In `schema.ts` after `printerNameMap` (or near other printer tables):

```typescript
export const printerProfileAssignments = sqliteTable("printer_profile_assignments", {
  printerId: text("printer_id").primaryKey(),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  machineProfileId: integer("machine_profile_id"),
  profileSource: text("profile_source").notNull().default("auto_match"),
  updatedAt: text("updated_at").notNull(),
});

export const printerFilamentSlotAssignments = sqliteTable(
  "printer_filament_slot_assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    printerId: text("printer_id").notNull(),
    slotIndex: integer("slot_index").notNull(),
    filamentProfileId: integer("filament_profile_id"),
  },
  (t) => [
    uniqueIndex("uq_printer_filament_slot").on(t.tenantId, t.printerId, t.slotIndex),
  ],
);
```

Set `export const currentSchemaVersion = 14;` and append to `schemaMigrations`:

```sql
CREATE TABLE IF NOT EXISTS printer_profile_assignments (
  printer_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  machine_profile_id INTEGER,
  profile_source TEXT NOT NULL DEFAULT 'auto_match',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS printer_filament_slot_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  printer_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  filament_profile_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_printer_filament_slot
  ON printer_filament_slot_assignments (tenant_id, printer_id, slot_index);
```

Mirror the same tables in `schema-pg.ts` (use `serial` / pg types consistent with neighboring tables). Add matching `CREATE TABLE IF NOT EXISTS` strings to `postgresPostInitMigrations` in `client-postgres.ts`.

- [ ] **Step 4: Run schema tests — expect PASS**

Run: `cd web && npx vitest run apps/server/src/db/schema-v9.test.ts`

- [ ] **Step 5: Commit**

```bash
git add web/apps/server/src/db/schema.ts web/apps/server/src/db/schema-pg.ts \
  web/apps/server/src/db/client-postgres.ts web/apps/server/src/db/schema-v9.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add v14 printer profile assignment tables

Store per-fleet-printer machine profile, source mode, and per-slot
filament profile assignments in SQLite and Postgres.
EOF
)"
```

---

### Task 3: Repository CRUD + profile id lookups

**Files:**
- Modify: `web/apps/server/src/db/repository.ts`
- Modify: `web/apps/server/src/db/repository.test.ts` (or create `printer-profile-assignments-repo.test.ts`)

**Interfaces:**
- Consumes: schema tables from Task 2; `latestSyncedAt`, `processCompatibleWithMachine` from Task 1
- Produces:
  - `getPrinterProfileAssignment(printerId: string): { machineProfileId: number | null; profileSource: ProfileSourceMode; updatedAt: string } | null`
  - `listFilamentSlotAssignments(printerId: string): Array<{ slotIndex: number; filamentProfileId: number | null }>`
  - `upsertPrinterProfileAssignment(input: { printerId: string; machineProfileId: number | null; profileSource: ProfileSourceMode; filamentSlots: Array<{ slotIndex: number; filamentProfileId: number | null }> }): void`
  - `getSlicerPrinterProfileById(id: number): (SlicerProfileRow & { lastSyncedAt: string | null }) | null`
  - `getSlicerFilamentProfileById(id: number): (SlicerProfileRow & { lastSyncedAt: string | null }) | null`
  - `listSlicerProcessProfilesDetailed(): Array<SlicerProfileRow & { compatiblePrinters: string | null }>`  
    (or extend existing list — prefer a dedicated method to avoid breaking callers)

- [ ] **Step 1: Write failing repository tests**

```typescript
it("upserts assignment and slot filaments, defaults to auto_match when missing", () => {
  withRepo((repo) => {
    expect(repo.getPrinterProfileAssignment("p1")).toBeNull();
    repo.upsertPrinterProfileAssignment({
      printerId: "p1",
      machineProfileId: null,
      profileSource: "assigned",
      filamentSlots: [
        { slotIndex: 1, filamentProfileId: null },
        { slotIndex: 2, filamentProfileId: null },
      ],
    });
    const row = repo.getPrinterProfileAssignment("p1");
    expect(row?.profileSource).toBe("assigned");
    expect(repo.listFilamentSlotAssignments("p1")).toEqual([
      { slotIndex: 1, filamentProfileId: null },
      { slotIndex: 2, filamentProfileId: null },
    ]);
  });
});
```

Seed real profile rows via existing upsert helpers if available (`upsertSyncedPrinterProfile` / filament equivalents) when testing FK-by-id lookups — ids are integers from inserts.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd web && npx vitest run apps/server/src/db/repository.test.ts` (or the new test file)

- [ ] **Step 3: Implement repository methods**

Follow existing Drizzle patterns in `AppRepository` (tenant filter, `.all()` / `.get()`, `runSerializedSettingsMutation` if other settings-like writes use it — assignment writes should be transactional: delete+insert slots then upsert header).

`upsertPrinterProfileAssignment` algorithm:
1. Validate `profileSource` is `assigned` | `auto_match`.
2. Upsert `printer_profile_assignments` with `updatedAt = new Date().toISOString()`.
3. Delete existing slot rows for `(tenantId, printerId)`.
4. Insert provided slots (normalize `slotIndex` to 1..4).

Lookups by id must select `lastSyncedAt` for last-synced aggregation in the route layer.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add web/apps/server/src/db/repository.ts web/apps/server/src/db/repository.test.ts
# include any new test file
git commit -m "$(cat <<'EOF'
feat(db): repository CRUD for printer profile assignments

Persist machine/filament assignments and load profile rows by id with
sync timestamps.
EOF
)"
```

---

### Task 4: HTTP API — get/put assignment view

**Files:**
- Modify: `web/apps/server/src/routes/printers.ts`
- Create: `web/apps/server/src/routes/printer-profile-assignment.test.ts` (Fastify inject pattern like other route tests)
- Modify: `web/apps/server/src/services/printer-profile-assignments.ts` — add `buildAssignmentView(repo, printerId, slotCount): PrinterProfileAssignmentView`

**Interfaces:**
- Consumes: repository methods from Task 3; fleet `max_filament_slots` / loaded slots from `loadFleet`
- Produces:
  - `GET /printers/:id/profile-assignment` → `PrinterProfileAssignmentView`
  - `PUT /printers/:id/profile-assignment` body:
    ```typescript
    {
      profile_source: "assigned" | "auto_match";
      machine_profile_id: number | null;
      filament_slots: Array<{ slot_index: number; filament_profile_id: number | null }>;
    }
    ```
  - Also useful for UI pickers (can be same route file or tiny additions):
    - Reuse `GET /profile-library` temporarily for pickers **or** add `GET /slicer-profiles?kind=printer|filament|process` — prefer reusing `listProfileLibrary` / existing lists via a thin `GET /printers/slicer-profile-options` returning `{ printers, filaments, processes }` with `{id,name,last_synced_at,material_type?}[]` so the SPA does not depend on the Export library panel.

- [ ] **Step 1: Write failing route test**

```typescript
it("GET returns auto_match defaults for unknown assignment", async () => {
  // create app with temp data dir + one fleet printer id "printer-abc"
  const res = await app.inject({ method: "GET", url: "/printers/printer-abc/profile-assignment" });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.profile_source).toBe("auto_match");
  expect(body.machine_profile_id).toBeNull();
  expect(body.last_synced_at).toBeNull();
});

it("PUT assigned machine then GET shows last_synced_at from that profile", async () => {
  // seed a printer_profiles row with last_synced_at set; PUT assignment; GET
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `buildAssignmentView` + routes**

```typescript
export function buildAssignmentView(
  repo: AppRepository,
  printerId: string,
  slotCount: number,
): PrinterProfileAssignmentView {
  const header = repo.getPrinterProfileAssignment(printerId);
  const profileSource = header?.profileSource ?? "auto_match";
  const machineProfileId = header?.machineProfileId ?? null;
  const storedSlots = repo.listFilamentSlotAssignments(printerId);
  const bySlot = new Map(storedSlots.map((s) => [s.slotIndex, s.filamentProfileId]));
  const filament_slots = [];
  for (let i = 1; i <= slotCount; i++) {
    filament_slots.push({
      slot_index: i,
      filament_profile_id: bySlot.get(i) ?? null,
    });
  }
  const machine = machineProfileId != null ? repo.getSlicerPrinterProfileById(machineProfileId) : null;
  const filamentTs = filament_slots.map((s) =>
    s.filament_profile_id != null
      ? repo.getSlicerFilamentProfileById(s.filament_profile_id)?.lastSyncedAt
      : null,
  );
  const last_synced_at = latestSyncedAt([machine?.lastSyncedAt, ...filamentTs]);
  const machineName = machine?.name ?? "";
  const compatible_processes = machineName
    ? repo
        .listSlicerProcessProfilesDetailed()
        .filter((p) => processCompatibleWithMachine(p.compatiblePrinters, machineName))
        .map((p) => ({ id: p.id, name: p.name }))
    : [];
  return {
    printer_id: printerId,
    profile_source: profileSource,
    machine_profile_id: machineProfileId,
    filament_slots,
    last_synced_at,
    compatible_processes,
  };
}
```

Register routes in `registerPrinterRoutes`:
- 404 if fleet has no printer with that id
- PUT validates body, calls `upsertPrinterProfileAssignment`, returns `buildAssignmentView`

Add `GET /slicer-profile-options` returning compact lists for pickers (id, name, kind, last_synced_at, material_type).

- [ ] **Step 4: Run route tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add web/apps/server/src/routes/printers.ts \
  web/apps/server/src/services/printer-profile-assignments.ts \
  web/apps/server/src/routes/printer-profile-assignment.test.ts
git commit -m "$(cat <<'EOF'
feat(api): expose printer profile assignment endpoints

Allow Settings to load and save per-printer machine/filament assignments
and compatible process summaries.
EOF
)"
```

---

### Task 5: Auto-slice routing honors assignments

**Files:**
- Modify: `web/apps/server/src/services/slicer-routing.ts`
- Modify: `web/apps/server/src/services/slicer-routing.test.ts`

**Interfaces:**
- Consumes: `getPrinterProfileAssignment`, slot assignments, profile-by-id from Task 3; `processCompatibleWithMachine` from Task 1
- Produces: updated `resolveFlatConfigsForPrinter(repo, printer, slicer)` behavior

Behavior contract:

```
if printer has assignment.profileSource === "assigned":
  machine := getById(assignment.machineProfileId)
  if !machine or !parseFlatConfig: push hard warning "Assign a machine profile …"; do not name-match machine
  else configs.machine = …
  filaments: for each fleet loaded_filaments slot in order, use filament_profile_id for that slot_index; skip empty; if zero filaments resolved → hard warning
  process: among process rows that profileMatchesSlicer AND (compatible with assigned machine name OR unrestricted), pick with pickProfileForPrinter(..., printerName) — still heuristic among compatible set
else:
  existing name-match behavior unchanged
```

Hard warnings for missing assigned machine should be worded so `slicer-settings` / auto-slice treats them as blocking (check how warnings are handled today — if warnings are non-fatal, add `errors: string[]` to `ResolveSettingsResult` **or** throw / return empty configs with a single warning that upstream already fails on). Inspect `slicer-settings.ts` around the `resolveFlatConfigsForPrinter` call and match the existing failure style. Prefer extending:

```typescript
export type ResolveSettingsResult = {
  configs: ResolvedFlatConfigs;
  warnings: string[];
  errors: string[]; // NEW — empty in auto_match path
  sources: Record<string, { id: number; name: string }>;
};
```

and make the caller fail the job when `errors.length > 0`.

- [ ] **Step 1: Write failing tests in `slicer-routing.test.ts`**

```typescript
it("assigned mode uses machine profile id, not name match", () => {
  // seed two machine profiles; fleet printer named like profile B;
  // assignment points at profile A with profile_source assigned
  // expect sources.machine.id === A
});

it("assigned mode without machine_profile_id yields errors and no machine config", () => {
  // expect errors nonempty; configs.machine undefined
});

it("auto_match mode ignores assignment machine id and keeps name match", () => {
  // assignment row present with machine A but profile_source auto_match
  // printer name matches B → sources.machine.id === B
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd web && npx vitest run apps/server/src/services/slicer-routing.test.ts`

- [ ] **Step 3: Implement routing branch + wire errors in `slicer-settings.ts`**

- [ ] **Step 4: Run slicer-routing + any slicer-settings / auto-slice tests touched — PASS**

Run: `cd web && npx vitest run apps/server/src/services/slicer-routing.test.ts apps/server/src/services/slicer-settings.ts`  
(If slicer-settings has no tests, run the auto-slice unit tests that resolve settings.)

- [ ] **Step 5: Commit**

```bash
git add web/apps/server/src/services/slicer-routing.ts \
  web/apps/server/src/services/slicer-routing.test.ts \
  web/apps/server/src/services/slicer-settings.ts
git commit -m "$(cat <<'EOF'
feat(slicer): honor per-printer profile assignments in routing

Use assigned machine and slot filaments when enabled; keep name-matching
for auto_match and fail clearly when assignments are incomplete.
EOF
)"
```

---

### Task 6: Remove Export Profile library UI

**Files:**
- Modify: `web/apps/web/src/pages/ExportPage.tsx`
- Delete: `web/apps/web/src/components/export/ProfileLibraryPanel.tsx`
- Grep and remove dead imports / `fetchProfileLibrary` usage from the Export path only — **keep** server `GET /profile-library` for now if Task 4 pickers still use it; otherwise switch pickers to `/slicer-profile-options` and leave `/profile-library` until Plan 2 (do not break API consumers unnecessarily). Prefer: SPA Export stops calling it; API may remain.

- [ ] **Step 1: Confirm sole UI consumer**

Run: `cd web && rg -n "ProfileLibraryPanel|fetchProfileLibrary" apps/web`

- [ ] **Step 2: Remove panel from `ExportPage.tsx`**

Delete the import and `<ProfileLibraryPanel />` JSX. Delete the component file if unused.

- [ ] **Step 3: Typecheck / lint touched packages**

Run: `cd web && npm run typecheck`

Expected: PASS (no missing module references)

- [ ] **Step 4: Commit**

```bash
git add web/apps/web/src/pages/ExportPage.tsx
git add -u web/apps/web/src/components/export/ProfileLibraryPanel.tsx
git commit -m "$(cat <<'EOF'
feat(web): remove Export profile library panel

Profile assignment and sync status move to Settings → Printers; Export
no longer shows the flat synced-profile grid.
EOF
)"
```

---

### Task 7: Settings → Printers assignment UI

**Files:**
- Modify: `web/apps/web/src/api/engine.ts` — client helpers
- Modify: `web/apps/web/src/components/settings/PrintersSettingsCard.tsx`
- Optional create: `web/apps/web/src/components/settings/PrinterProfileAssignmentSection.tsx` (preferred if card is already ~900 lines)

**Interfaces:**
- Consumes: `GET/PUT /printers/:id/profile-assignment`, `GET /slicer-profile-options`
- Produces: UI showing for each fleet printer:
  - Toggle: Use assigned profiles | Auto-match by name
  - Machine profile `<Select>`
  - One filament `<Select>` per `max_filament_slots`
  - Read-only compatible process chips
  - “Last synced …” or “Not synced”
  - Save (debounced or explicit Save button — match existing fleet save patterns in this card)

- [ ] **Step 1: Add API client functions**

```typescript
export type PrinterProfileAssignment = {
  printer_id: string;
  profile_source: "assigned" | "auto_match";
  machine_profile_id: number | null;
  filament_slots: Array<{ slot_index: number; filament_profile_id: number | null }>;
  last_synced_at: string | null;
  compatible_processes: Array<{ id: number; name: string }>;
};

export async function fetchPrinterProfileAssignment(
  printerId: string,
): Promise<PrinterProfileAssignment> {
  return engineFetch(`/printers/${encodeURIComponent(printerId)}/profile-assignment`);
}

export async function savePrinterProfileAssignment(
  printerId: string,
  body: {
    profile_source: "assigned" | "auto_match";
    machine_profile_id: number | null;
    filament_slots: Array<{ slot_index: number; filament_profile_id: number | null }>;
  },
): Promise<PrinterProfileAssignment> {
  return engineFetch(`/printers/${encodeURIComponent(printerId)}/profile-assignment`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function fetchSlicerProfileOptions(): Promise<{
  printers: Array<{ id: number; name: string; last_synced_at: string | null }>;
  filaments: Array<{
    id: number;
    name: string;
    material_type: string | null;
    last_synced_at: string | null;
  }>;
  processes: Array<{ id: number; name: string; last_synced_at: string | null }>;
}> {
  return engineFetch("/slicer-profile-options");
}
```

- [ ] **Step 2: Build `PrinterProfileAssignmentSection`**

Props: `{ printer: PrinterMachine; engineReady: boolean }`.

On mount / printer id change: fetch assignment + options. Local state for edits. Save button calls PUT then replaces state with response (so `last_synced_at` / compatible list refresh).

When `profile_source === "auto_match"`, disable machine/filament selects (or hide them) and show short copy: “Profiles are matched by name when slicing.”

Format `last_synced_at` with `toLocaleString()`; null → “Not synced”.

- [ ] **Step 3: Mount section inside each printer row/card in `PrintersSettingsCard.tsx`**

Place below bed/slots/host binding so assignment is visible per machine.

- [ ] **Step 4: Manual smoke (dev)**

Run: `cd web && npm run dev`  
Open Settings → Printers: toggle assigned, pick machine + filaments, save, refresh page — values persist. Export page: Profile library gone.

- [ ] **Step 5: Commit**

```bash
git add web/apps/web/src/api/engine.ts \
  web/apps/web/src/components/settings/PrinterProfileAssignmentSection.tsx \
  web/apps/web/src/components/settings/PrintersSettingsCard.tsx
git commit -m "$(cat <<'EOF'
feat(web): assign slicer profiles per fleet printer

Add Settings UI for machine and per-slot filament profiles, sync time,
compatible processes, and assigned vs auto-match routing.
EOF
)"
```

---

### Task 8: Docs + verification gate

**Files:**
- Modify: `docs/API.md` — document `GET/PUT /printers/:id/profile-assignment` and `GET /slicer-profile-options`
- Modify: `docs/ARCHITECTURE.md` — one short bullet that fleet printers can pin slicer profiles; Export library removed

- [ ] **Step 1: Update API/ARCHITECTURE briefly** (no new markdown files beyond these edits)

- [ ] **Step 2: Run focused test suites**

```bash
cd web && npx vitest run \
  apps/server/src/services/printer-profile-assignments.test.ts \
  apps/server/src/db/schema-v9.test.ts \
  apps/server/src/services/slicer-routing.test.ts \
  apps/server/src/routes/printer-profile-assignment.test.ts
cd web && npm run typecheck
```

Expected: all PASS

- [ ] **Step 3: Commit docs**

```bash
git add docs/API.md docs/ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
docs: document printer profile assignment API

Note Settings-based assignment and removal of the Export profile library.
EOF
)"
```

---

## Self-review (plan vs spec Plan-1 scope)

| Spec requirement (ship step 1) | Task |
|--------------------------------|------|
| Remove Export Profile library | Task 6 |
| Assign machine + filament per slot on Settings → Printers | Tasks 3–4, 7 |
| Compatible processes read-only | Tasks 1, 4, 7 |
| Last synced = max of assigned machine + slot filaments | Tasks 1, 4, 7 |
| Per-printer assigned vs auto-match toggle | Tasks 2–5, 7 |
| Routing uses assignments when assigned | Task 5 |
| Object name / 3MF unchanged | Global constraint; no export-3mf edits |
| Slicer Hub / Docker / export handoff | Deferred Plans 2–4 |

No TBD placeholders. Types (`ProfileSourceMode`, `PrinterProfileAssignmentView`, route bodies) are consistent across tasks.
