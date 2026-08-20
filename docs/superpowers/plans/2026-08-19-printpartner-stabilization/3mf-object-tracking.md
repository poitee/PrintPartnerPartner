# 3MF object tracking in PrintPartner

## Conclusion

The existing mechanic works at the plate and print-job level. PrintPartner puts readable part names into a 3MF, later reads names from sliced files or printer APIs, proposes the corresponding unchecked units, follows the host job by filename and status, then waits for a person to confirm or reject the proposed units.

It does not track the object currently under the nozzle. The live status contract has state, overall progress, filename, message, and ETA, but no current-object field. Moonraker exposes the `exclude_object.objects` list through a separate call. PrusaLink looks for an `objects_info` list in the job file header. Neither path selects one object as the current object. Bambu exposes no object list in this adapter. [PrinterHostStatus](../../../../web/packages/contracts/src/index.ts#L185-L201) [Moonraker status and object list](../../../../web/apps/server/src/integrations/adapters/moonraker.ts#L93-L168) [PrusaLink object list](../../../../web/apps/server/src/integrations/adapters/prusalink.ts#L335-L409) [Bambu adapter](../../../../web/apps/server/src/integrations/adapters/bambu.ts#L383-L399)

The object name is the only identity that crosses the 3MF, slicer, G-code, and printer-host boundaries in the current design. The durable PrintPartner identity is still `part_id + unit_index` on a checkoff link. The code connects those two identities by name matching before the print or when it discovers a printer job. [3MF name writer](../../../../web/packages/domain/src/export-3mf.ts#L111-L153) [checkoff contracts](../../../../web/packages/contracts/src/index.ts#L203-L207) [linked print record](../../../../web/packages/contracts/src/index.ts#L268-L300)

## Exact object naming in a PrintPartner 3MF

PrintPartner starts with the STL basename. It replaces characters outside letters, numbers, underscores, whitespace, dots, hyphens, parentheses, and plus signs with `_`, then limits the result to 200 characters. Directory names are discarded. [sanitize3mfObjectName](../../../../web/packages/domain/src/export-3mf.ts#L15-L16) [sanitize3mfObjectName implementation](../../../../web/packages/domain/src/export-3mf.ts#L38-L42)

The first unit normally keeps the plain basename, such as `bracket.stl`. Later units normally become `bracket.stl (2)`, `bracket.stl (3)`, and so on. If two different parts collapse to the same sanitized basename, the later object receives the next free numbered name. The uniqueness set resets for each plate file, so a name is unique inside one generated 3MF, not across a whole Build. [objectDisplayName](../../../../web/packages/domain/src/export-3mf.ts#L44-L81) [per-plate name set](../../../../web/packages/domain/src/export-3mf.ts#L254-L261)

The XML writer puts that display name in three places: `object@name`, `object@partnumber`, and the build item's `partnumber`. Numeric 3MF object IDs start at 2 and are generated while writing the file. They do not contain `match_key`, `part_id`, or unit identity. [model XML writer](../../../../web/packages/domain/src/export-3mf.ts#L103-L153) [object construction](../../../../web/packages/domain/src/export-3mf.ts#L211-L239)

The saved plate plan has a stronger internal identity. Every placed copy is recorded as `match_key + unit`, where `unit` is one-based. That identity drives plate assignment and reconstructs the chosen layout before export, but the exporter reduces it to the display name described above. [CopyRef](../../../../web/packages/domain/src/plate-plan.ts#L11-L19) [saved plate layout](../../../../web/packages/domain/src/plate-plan.ts#L21-L31) [layout resolution](../../../../web/packages/domain/src/plate-plan.ts#L131-L193) [name selection during export](../../../../web/packages/domain/src/export-3mf.ts#L220-L237)

## What survives the slicer handoff

PrintPartner's managed slicer handoff copies the generated 3MF byte for byte into an exchange inbox. It does not edit the archive or its object names. [slicer handoff](../../../../web/apps/server/src/services/slicer-handoff.ts#L19-L63)

After a slicer opens and saves or slices the file, preservation depends on what that slicer writes. The repository's validation guide says PrusaSlicer and Orca use `object@name` for their object lists, but the listed proof is a manual import checklist. Automated tests prove the PrintPartner archive contains the names. They do not run a real slicer and inspect its output. [validation expectations](../../../3MF_EXPORT_VALIDATION.md#L1-L13) [manual slicer checklist](../../../3MF_EXPORT_VALIDATION.md#L25-L37) [automated coverage statement](../../../3MF_EXPORT_VALIDATION.md#L39-L43)

On the way back in, the browser can read object names from these channels:

- `EXCLUDE_OBJECT_DEFINE` lines used by Klipper-oriented G-code.
- `M486 A` labels.
- `; printing object` comments.
- `object@name` attributes in `.3mf` and `.gcode.3mf` archives.
- Best-effort ASCII runs inside binary G-code.

The parser deduplicates equal names case-insensitively. It also reads a plate thumbnail, estimated duration, and filament weight when those fields exist. [G-code patterns](../../../../web/apps/web/src/lib/parseSlicedObjects.ts#L1-L89) [3MF parsing](../../../../web/apps/web/src/lib/parseSlicedObjects.ts#L145-L262) [file dispatch](../../../../web/apps/web/src/lib/parseSlicedObjects.ts#L280-L302)

Custom opaque metadata would not improve the current tracking path by itself. PrintPartner only reads the visible name channels above, and its printer adapters return either a host filename or an array of object names. A new metadata field would help only if each slicer preserved it and a later file parser or printer API exposed it. [integration adapter contract](../../../../web/apps/server/src/integrations/store.ts#L12-L31) [browser parser inputs](../../../../web/apps/web/src/lib/parseSlicedObjects.ts#L34-L40)

## Sent from PrintPartner

For Moonraker and PrusaLink, the user chooses an already-sliced `.gcode`, `.gco`, or `.bgcode` file. The browser parses its object names and proposes unchecked units before sending. A named file pauses at a preview instead of uploading immediately. [send file handling](../../../../web/apps/web/src/components/export/PrinterSendPanel.tsx#L342-L471)

The client sends the chosen Build ID, the proposed `part_id + unit_index` pairs, and unmatched names with the G-code. Once the host accepts the upload, the server creates a checkoff link with an immutable Build binding, host and printer IDs, local and remote filenames, upload job ID, proposed units, and unmatched names. [client upload payload](../../../../web/apps/web/src/components/export/PrinterSendPanel.tsx#L366-L401) [upload result and link creation](../../../../web/apps/server/src/services/printer-upload-job.ts#L128-L185)

Matched object names are not persisted on this linked record. The link stores the resulting units and only the names that failed to map. This is enough to show which Build units the plate is expected to produce, but it removes the audit trail from each original object label to its mapped unit. Unattributed prints are different: their record does retain raw G-code object names and candidate filenames. [link fields](../../../../web/packages/contracts/src/index.ts#L273-L300) [link storage](../../../../web/apps/server/src/services/printer-checkoff-store.ts#L207-L247) [unattributed print fields](../../../../web/apps/server/src/services/unattributed-print-store.ts#L4-L25)

For Bambu, the browser parses a user-selected 3MF or G-code and sends proposed units to the Bambu Connect handoff route. The server stages the file, returns the official Connect URL, and creates a checkoff link when the selected fleet printer has a Bambu integration. PrintPartner does not start the print through MQTT. [Bambu client handoff](../../../../web/apps/web/src/components/export/PrinterSendPanel.tsx#L474-L551) [Bambu route](../../../../web/apps/server/src/routes/bambu-connect.ts#L86-L95) [Bambu link creation](../../../../web/apps/server/src/routes/bambu-connect.ts#L222-L270)

## Discovered on a printer

The Progress page polls linked Moonraker and PrusaLink hosts through the reconcile endpoint. If it sees a new printing or paused filename and the printer has a default Build binding, the server asks the adapter for all object names, maps them to that Build's unchecked units, and creates a watching link. [Progress polling](../../../../web/apps/web/src/components/checkoff/PrinterLiveStrip.tsx#L93-L100) [reconcile polling](../../../../web/apps/web/src/components/checkoff/PrinterLiveStrip.tsx#L179-L215) [auto-created link](../../../../web/apps/server/src/routes/printer-checkoff.ts#L364-L410)

If a host reports a completed filename with no matching link, the server records an unattributed print. It stores the raw object names and candidate matches across the library. The user can claim that print for a Build, which creates an `awaiting_verify` link and updates the printer's default Build binding. [unattributed completion](../../../../web/apps/server/src/routes/printer-checkoff.ts#L317-L355) [claim flow](../../../../web/apps/server/src/routes/printer-checkoff.ts#L559-L639)

## Moonraker, PrusaLink, and Bambu

| Integration | Host status | Object source | Send path | Current Progress behavior |
| --- | --- | --- | --- | --- |
| Moonraker | Reads print state, total progress, and filename from `print_stats`, `virtual_sdcard`, and `display_status`. | Reads every name in `exclude_object.objects`. | Uploads G-code and can start it. | Reconciles the filename and job status, then queues user verification. No current-object tracking. |
| PrusaLink | Reads state, total progress, filename, and ETA from status and job endpoints. | Downloads the first 65,536 bytes of the active or finished job and parses `objects_info`. | Uploads G-code and can request print after upload. | Reconciles the filename and job status, then queues user verification. No current-object tracking. |
| Bambu | Reads state, total progress, ETA, and `subtask_name` or `gcode_file` through LAN MQTT. | None. The adapter has no `getObjectList`. | Bambu Connect handoff only. The MQTT adapter has no upload method. | The current UI polls status only. It deliberately does not run checkoff reconciliation for Bambu. |

Sources: [Moonraker adapter](../../../../web/apps/server/src/integrations/adapters/moonraker.ts#L93-L168) [Moonraker upload](../../../../web/apps/server/src/integrations/adapters/moonraker.ts#L252-L319) [PrusaLink status](../../../../web/apps/server/src/integrations/adapters/prusalink.ts#L208-L264) [PrusaLink objects](../../../../web/apps/server/src/integrations/adapters/prusalink.ts#L335-L409) [PrusaLink upload](../../../../web/apps/server/src/integrations/adapters/prusalink.ts#L433-L505) [Bambu status](../../../../web/apps/server/src/integrations/adapters/bambu.ts#L92-L165) [Bambu capabilities](../../../../web/apps/server/src/integrations/adapters/bambu.ts#L383-L399) [Progress integration policy](../../../../web/apps/web/src/components/checkoff/PrinterLiveStrip.tsx#L24-L36) [Progress roster](../../../../web/apps/web/src/components/checkoff/PrinterLiveStrip.tsx#L137-L150)

The Bambu handoff link and the reported Bambu job are not currently equivalent to a Moonraker or PrusaLink tracked send. The link starts in `watching`, but the normal Progress polling path never reconciles Bambu. Even if another caller invoked reconciliation, the staged 3MF filename and Bambu's later `subtask_name` or `gcode_file` would need to match for normal lifecycle detection. [Bambu link creation](../../../../web/apps/server/src/routes/bambu-connect.ts#L237-L249) [filename matching](../../../../web/apps/server/src/services/printer-checkoff.ts#L15-L29) [reconcile decision](../../../../web/apps/server/src/services/printer-checkoff.ts#L96-L143)

## How names map to `part_id + unit_index`

The browser path first tries an exact exported-unit convention such as `bracket_01` for zero-based `unit_index: 0`. That convention comes from missing-STL export, which writes one file per physical unit as `stem_01.stl`, `stem_02.stl`, and so on. Remaining names fall back to a normalized stem. Each matching name consumes the next unchecked slot for a part with that stem. [missing-STL naming](../../../../web/apps/server/src/services/export-stl-pack.ts#L32-L45) [browser key normalization](../../../../web/apps/web/src/lib/proposeCheckoffFromObjects.ts#L106-L165) [proposal algorithm](../../../../web/apps/web/src/lib/proposeCheckoffFromObjects.ts#L168-L245)

The server discovery path groups names by normalized STL basename and count. It compares those basenames to filenames on the bound Build, then assigns the group's count to the first unchecked unit indexes. The G-code parser can extract a copy index from some Orca and Prusa names, but the mapping loop does not use that index. It uses only the grouped count. [G-code name parser](../../../../web/apps/server/src/services/gcode-object-parser.ts#L21-L80) [grouping](../../../../web/apps/server/src/services/gcode-object-parser.ts#L82-L164) [server unit mapping](../../../../web/apps/server/src/routes/printer-checkoff.ts#L96-L151)

The generated PrintPartner 3MF name therefore does not encode an exact `part_id + unit_index` identity. `bracket.stl (2)` says which filename and copy number a person should see. It is not the same convention as missing-STL export's `bracket_02.stl`.

There is also an untested round-trip edge here. The browser removes mesh extensions before removing the trailing `(2)` tag. Given the raw generated name `bracket.stl (2)`, that order leaves the normalized key as `bracket.stl`, while the part's normalized stem is `bracket`. The server matcher does not remove the `(2)` suffix either. A slicer may rewrite the name into a form the parsers recognize, but the repository has no test that passes PrintPartner's multi-copy 3MF names through a real slicer and back into unit mapping. [browser normalization order](../../../../web/apps/web/src/lib/proposeCheckoffFromObjects.ts#L113-L145) [server normalization](../../../../web/apps/server/src/services/gcode-object-parser.ts#L166-L255) [manual-only slicer check](../../../3MF_EXPORT_VALIDATION.md#L25-L43)

Do not promote the legacy `filename.stl (2)` path to automatic completion
evidence. Phase 9 replaces it with the stored Required-unit token names defined
below, and Phase 10 release-gates that path on a real supported-slicer
round-trip. Until then, legacy multi-copy labels remain confirmation-required
proposals.

Two source repositories can also contain the same basename. Because the tracking match uses filename rather than `match_key`, such collisions are inherently ambiguous. [generated copy name](../../../../web/packages/domain/src/export-3mf.ts#L55-L81) [filename-only server lookup](../../../../web/apps/server/src/routes/printer-checkoff.ts#L107-L145)

## Filename and status lifecycle

A linked print begins in `watching`. While the host reports `printing` or `paused`, PrintPartner changes the link only when the host filename matches the stored local or remote filename. It records that the job became active and keeps the highest observed overall progress. [decision logic](../../../../web/apps/server/src/services/printer-checkoff.ts#L96-L117) [active update](../../../../web/apps/server/src/services/printer-checkoff.ts#L221-L262)

A matching `complete` state moves the link to `awaiting_verify`. A cleared host filename can also finish a link after PrintPartner observed it active or started it itself. If an active job returns to idle, at least 99 percent progress counts as a missed completion. Otherwise the link becomes `host_failed` with a cancelled outcome. A host error becomes `host_failed` only after PrintPartner observed the link active or the filename matches. None of those transitions marks a checklist unit complete. [completion and failure decisions](../../../../web/apps/server/src/services/printer-checkoff.ts#L119-L143) [stored transitions](../../../../web/apps/server/src/services/printer-checkoff.ts#L265-L315)

This is job-level tracking. Progress shows every proposed unit on the link as printing while that host is active. It does not show which single object is printing now. [watching presentation](../../../../web/apps/web/src/components/checkoff/PrintVerifyPanel.tsx#L255-L277)

## What user verification changes

After host completion, the user confirms or rejects the proposed units. Confirm marks those units printed in the existing checkoff state. Reject leaves them unchecked and records a failure reason and optional note. PrintPartner also records an outcome event with the Build, part, unit, integration, job filename, and `match_key` when available. [verification behavior](../../../../web/apps/server/src/services/printer-checkoff-verify.ts#L89-L151) [transaction and outcomes](../../../../web/apps/server/src/services/printer-checkoff-verify.ts#L153-L225)

The current checklist uses fill-from-left semantics. Confirming unit index 2 may mark indexes 0 through 2, so the verifier refuses a decision that omits an unchecked lower index. This protects the current count-based checklist model, but it also confirms that unit identity is positional rather than a durable physical-object record. [prefix rule](../../../../web/apps/server/src/services/printer-checkoff.ts#L146-L199) [verification guard](../../../../web/apps/server/src/services/printer-checkoff-verify.ts#L124-L151)

## Confirmed behavior and sharp edges

Repository tests cover the important pieces independently:

- The 3MF writer emits `bracket.stl`, `bracket.stl (2)`, and `object@name`. [3MF naming tests](../../../../web/packages/domain/src/export-3mf.test.ts#L26-L36) [3MF archive test](../../../../web/packages/domain/src/export-3mf.test.ts#L55-L106)
- The browser parses named G-code and `.gcode.3mf` objects, then maps `stem_01` labels to remaining units without checking anything off. [parser tests](../../../../web/apps/web/src/lib/parseSlicedObjects.test.ts#L10-L119) [proposal tests](../../../../web/apps/web/src/lib/proposeCheckoffFromObjects.test.ts#L34-L112)
- The server creates a watching link for a discovered PrusaLink print, preserves an unchecked Progress unit while it runs, moves it to verification on completion, and checks it only after confirm. [discovery test](../../../../web/apps/server/src/routes/printer-checkoff-progress.test.ts#L119-L169) [completion and verify test](../../../../web/apps/server/src/routes/printer-checkoff-progress.test.ts#L350-L428)
- Verify-first tests assert that host completion alone does not tick Progress and that reject leaves a unit unprinted. [verify-first tests](../../../../web/apps/server/src/services/printer-checkoff-verify.test.ts#L41-L136)

These tests were inspected but not rerun for this note because the checkout does not have `web/node_modules` installed.

The main fallbacks and limits are clear in the code:

- If the client cannot read labels, it can still send a file, but the resulting link may have no proposed units. Later reads make a best-effort repair from unmatched names or the job filename. [unlabeled send](../../../../web/apps/web/src/components/export/PrinterSendPanel.tsx#L444-L470) [empty-link repair](../../../../web/apps/server/src/routes/printer-checkoff.ts#L164-L193)
- Object and filename matching is based on normalized basenames and counts. It cannot reliably distinguish equal filenames from different source repositories. [filename matcher](../../../../web/apps/server/src/services/gcode-object-parser.ts#L166-L255)
- PrusaLink object discovery reads only the first 65,536 bytes and returns no objects if `objects_info` is absent or extends beyond the downloaded range. [PrusaLink range parser](../../../../web/apps/server/src/integrations/adapters/prusalink.ts#L350-L407)
- Binary G-code parsing in the browser harvests printable ASCII instead of decoding the binary format. This is intentionally best-effort. [binary parser](../../../../web/apps/web/src/lib/parseSlicedObjects.ts#L166-L187)
- Linked records discard matched object labels after converting them to units. Only unmatched labels remain visible. [linked record shape](../../../../web/packages/contracts/src/index.ts#L273-L299)
- The generated multi-copy name `filename.stl (2)` and missing-STL name `filename_02.stl` follow different conventions. Current tests cover each side separately, not a direct 3MF-to-slicer-to-unit round trip. [3MF naming test](../../../../web/packages/domain/src/export-3mf.test.ts#L32-L36) [proposal naming test](../../../../web/apps/web/src/lib/proposeCheckoffFromObjects.test.ts#L34-L51)
- The 3MF's Bambu plate metadata currently has an empty `object_ids` array. Tracking does not use that field. [3MF package metadata](../../../../web/packages/domain/src/export-3mf.ts#L180-L207)

## Implications for the workflow redesign

The workflow can keep this mechanic, but it should describe it accurately.

- A plate contains required units and readable exported object names.
- A sent or discovered printer job has proposed units. During printing, those units are "on this job," not individually "currently printing."
- Host completion moves the job to "awaiting verification." It does not complete checklist units.
- Confirm and reject remain the authority for the electronic and printable checklist.
- The workflow should preserve the `match_key + unit` mapping when a plate is planned and the `part_id + unit_index` mapping when it is sent. The readable object name remains the cross-system correlation key.
- Any stronger per-object tracking claim needs a slicer and printer API path that preserves and exposes the chosen identity. Adding hidden metadata only to PrintPartner's 3MF is not enough.

The redesign must replace basename-derived identity before enabling automatic
completion evidence. Assign each accepted Required unit one stored Object name
made from a readable sanitized stem and a stable Required-unit token, such as
`bracket__pp_7K2M_02`. Carry that identity forward only when Plan revision
mapping proves it is the same Required unit. The token makes equal basenames
from different Sources distinct without depending on a mutable path.

Build the final name by sanitizing the readable stem, reserving space for the
complete token and separator within the 200-character limit, and truncating
only the stem. Run final sanitization, then check the per-Plate final-name set
before storing the mapping. A collision is an export error; never shorten or
renumber the token. Assert that every final Object name is unique and still
ends with its expected Required-unit token.

Persist the exact Object-name mapping on the immutable Plate revision and the
Printer job. First identify the candidate artifact or manifest; resolve exact
stored Object names only inside that Plate revision. A stable Object name alone
cannot select between historical Plate revisions. Require confirmation when
more than one artifact remains possible, and treat legacy basename matching as
an ambiguous suggestion. A real-slicer round-trip fixture must cover later
copies and equal basenames from different Sources before stronger evidence
levels use these mappings.

This supports the proposed Build model. A Build owns required units and checkoff state. A production operation owns plates, printer jobs, host status, and proposed mappings. The current code already has most of those pieces, but it should not present plate-level progress as live per-object tracking.

## Accepted tracking workflow

The normal handoff does not route the sliced file back through PrintPartner.
The user opens the Plate 3MF in a local slicer and sends it using the slicer's
normal Printer integration. For Moonraker and PrusaLink, PrintPartner watches
through the optional Printer connection and proposes a Printer job match from
the stable Plate filename and preserved Object names. Bambu handoff and status
remain outside Checkoff reconciliation until that adapter gains the same
verified path.

The user confirms ambiguous matches. Upload through PrintPartner remains an
optional shortcut only for Printer connections that support it. PrintPartner
does not transfer sliced files between Printers.

Once matched, the Printer job reports the status, progress, and ETA available
from its connection. Host completion moves the job to Awaiting verification.
Only user confirmation updates the Checkoff sheet.
