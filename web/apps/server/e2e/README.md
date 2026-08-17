# Auto-slice end-to-end harness

Drives PP's real auto-slice job (`services/auto-slice-job.ts`) against the real
Python `slicer_sidecar` service. Everything in the path is genuine — the 3MF is
produced by PP's own `export-3mf` job from a real plan, the sidecar is a live
uvicorn process, the CLI is exec'd as a subprocess, and the gcode/thumbnail come
back through real HTTP. Only the slicer binary itself is a stand-in, because no
OrcaSlicer/PrusaSlicer/BambuStudio build is installable in this environment.

## The fake CLIs are strict on purpose

`fake-orca-slicer` (also symlinked in as `bambu-studio-cli`) and
`fake-prusa-slicer` validate what they are handed and exit non-zero when it is
wrong, so a bad settings translation fails the harness instead of silently
producing gcode:

- argv shape (`--slice 0`, `--arrange`, `--allow-rotations`, `--min-save`,
  `--export-3mf` / `--load` + `--export-gcode --output`)
- every named settings file exists on disk
- the input is a readable 3MF/zip
- **preset schema**: required fields per type (`nozzle_diameter` +
  `printable_area` for machine, `layer_height` for process, `filament_type` for
  filament), `instantiation` is the string `"true"`, per-extruder fields are
  arrays of strings, filaments arrive via `--load-filaments` and machine/process
  via `--load-settings` with machine first, and `compatible_printers` resolves to
  the loaded machine preset's name
- PrusaSlicer: `key = value` INI only, and an unknown option aborts the load
  exactly as the real binary does

On success they emit realistic output: Orca/Bambu write an `output.gcode.3mf`
zip containing `Metadata/plate_1.gcode` and a valid 120x120 PNG; Prusa writes a
single gcode with the thumbnail embedded as a base64 `; thumbnail begin/end`
block, which is what the sidecar's prusa backend decodes.

`fake-prusa-slicer` writes that block **only when the loaded config sets
`thumbnails`**, exactly like the real binary — with the option absent it emits
gcode with no thumbnail at all and the sidecar answers 502
`slicer_output_parse_error`. That conditional is load-bearing: PP has no
`thumbnails` field in any profile schema, so `slicer-settings.ts` synthesizes
the option, and an unconditional fake would let a regression there ship
silently (it did once — task t_a9af03d0).

## Run it

```bash
# 1. start three sidecars (orca 8321, prusa 8322, bambu 8323 by default)
e2e/start_sidecars.sh /path/to/slicer_sidecar /path/to/venv/bin/python

# 2. the end-to-end test
E2E_SIDECARS=1 npx vitest run src/services/auto-slice-e2e.test.ts

# 3. or produce inspectable artifacts on disk
npx tsx e2e/verify_auto_slice.ts /tmp/pp-slice-verify

# 4. tear down
e2e/stop_sidecars.sh
```

Ports are overridable via `E2E_PORT_ORCA` / `E2E_PORT_PRUSA` / `E2E_PORT_BAMBU`
(both the script and the test read them), which matters when another sidecar is
already bound locally.

## Against real slicers

Point the sidecar at real binaries instead of the fakes and re-run the same
test:

```bash
ORCA_SLICER_BIN=/usr/bin/orca-slicer \
PRUSA_SLICER_BIN=/usr/bin/prusa-slicer \
BAMBU_STUDIO_CLI_BIN=/usr/bin/bambu-studio-cli \
  python -m uvicorn slicer_sidecar.app:app --port 8321
```

The assertions that read preset values back out of the gcode comments
(`; nozzle_diameter = 0.4`, …) are fake-CLI specific and would need loosening;
everything else — routing, settings translation, gcode/PNG persistence, stderr
surfacing — applies unchanged.
