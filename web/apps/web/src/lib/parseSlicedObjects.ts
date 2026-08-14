/**
 * Client-side parse of already-sliced files for object labels.
 * Supports EXCLUDE_OBJECT_DEFINE (Moonraker/Klipper), M486 labels, and
 * .3mf / .gcode.3mf object@name attributes. Never talks to a print host.
 */

import JSZip from "jszip";

export type SlicedObjectSource =
  | "exclude_object_define"
  | "m486"
  | "3mf_object"
  | "comment";

export type ParsedSlicedObject = {
  name: string;
  source: SlicedObjectSource;
};

export type ParseSlicedObjectsResult = {
  objects: ParsedSlicedObject[];
  /** Distinct object names in first-seen order. */
  names: string[];
  format: "gcode" | "bgcode" | "3mf" | "unknown";
  unlabeled: boolean;
};

const EXCLUDE_NAME_EQ = /EXCLUDE_OBJECT_DEFINE\b[^\n]*?\bNAME\s*=\s*"?([^"\s,]+)"?/gi;
const EXCLUDE_NAME_JSON = /EXCLUDE_OBJECT_DEFINE\b[^\n]*?"name"\s*:\s*"([^"]+)"/gi;
const M486_A_QUOTED = /\bM486\b[^\n]*?\bA\s*"([^"]+)"/gi;
const M486_A_BARE = /\bM486\b[^\n]*?\bA\s*([^\s;]+)/gi;
const PRINTING_OBJECT = /;\s*printing object\s+(\S+?)(?:\s+id:\d+)?(?:\s+copy\s+\d+)?\s*$/gim;

const OBJECT_NAME_ATTR = /<object\b[^>]*\bname\s*=\s*"([^"]+)"/gi;

function pushUnique(
  out: ParsedSlicedObject[],
  seen: Set<string>,
  name: string,
  source: SlicedObjectSource,
): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ name: trimmed, source });
}

/** Extract object labels from G-code / comment text. */
export function parseGcodeObjectText(text: string): ParsedSlicedObject[] {
  const out: ParsedSlicedObject[] = [];
  const seen = new Set<string>();

  for (const re of [EXCLUDE_NAME_EQ, EXCLUDE_NAME_JSON]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) != null) {
      pushUnique(out, seen, m[1] ?? "", "exclude_object_define");
    }
  }

  M486_A_QUOTED.lastIndex = 0;
  let m486: RegExpExecArray | null;
  while ((m486 = M486_A_QUOTED.exec(text)) != null) {
    pushUnique(out, seen, m486[1] ?? "", "m486");
  }
  M486_A_BARE.lastIndex = 0;
  while ((m486 = M486_A_BARE.exec(text)) != null) {
    const raw = (m486[1] ?? "").replace(/^"+|"+$/g, "");
    // Skip pure numeric M486 A indexes (A0 / A1) — those are not labels.
    if (/^\d+$/.test(raw)) continue;
    pushUnique(out, seen, raw, "m486");
  }

  PRINTING_OBJECT.lastIndex = 0;
  let comment: RegExpExecArray | null;
  while ((comment = PRINTING_OBJECT.exec(text)) != null) {
    pushUnique(out, seen, comment[1] ?? "", "comment");
  }

  return out;
}

/** Pull object@name from 3MF model XML. */
export function parse3mfObjectNamesFromXml(xml: string): ParsedSlicedObject[] {
  const out: ParsedSlicedObject[] = [];
  const seen = new Set<string>();
  OBJECT_NAME_ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OBJECT_NAME_ATTR.exec(xml)) != null) {
    pushUnique(out, seen, m[1] ?? "", "3mf_object");
  }
  return out;
}

function detectFormat(filename: string): ParseSlicedObjectsResult["format"] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".gcode.3mf") || lower.endsWith(".3mf")) return "3mf";
  if (lower.endsWith(".bgcode")) return "bgcode";
  if (lower.endsWith(".gcode") || lower.endsWith(".gco")) return "gcode";
  return "unknown";
}

/** Best-effort ASCII harvest from binary buffers (bgcode / mixed). */
export function extractAsciiChunks(bytes: Uint8Array, minRun = 12): string {
  const parts: string[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    if (end - start >= minRun) {
      parts.push(new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(start, end)));
    }
    start = -1;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) {
      if (start < 0) start = i;
    } else {
      flush(i);
    }
  }
  flush(bytes.length);
  return parts.join("\n");
}

async function parse3mfArchive(bytes: ArrayBuffer): Promise<ParsedSlicedObject[]> {
  const zip = await JSZip.loadAsync(bytes);
  const out: ParsedSlicedObject[] = [];
  const seen = new Set<string>();

  const merge = (rows: ParsedSlicedObject[]) => {
    for (const row of rows) pushUnique(out, seen, row.name, row.source);
  };

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const lower = path.toLowerCase();
    if (lower.endsWith(".model") || lower.endsWith(".xml")) {
      try {
        const xml = await entry.async("string");
        merge(parse3mfObjectNamesFromXml(xml));
      } catch {
        /* skip unreadable entries */
      }
    } else if (
      lower.endsWith(".gcode") ||
      lower.endsWith(".gco") ||
      lower.endsWith(".bgcode")
    ) {
      try {
        const text =
          lower.endsWith(".bgcode")
            ? extractAsciiChunks(await entry.async("uint8array"))
            : await entry.async("string");
        merge(parseGcodeObjectText(text));
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

function finish(
  objects: ParsedSlicedObject[],
  format: ParseSlicedObjectsResult["format"],
): ParseSlicedObjectsResult {
  const names = objects.map((o) => o.name);
  return {
    objects,
    names,
    format,
    unlabeled: names.length === 0,
  };
}

/**
 * Parse a user-chosen sliced file for object names.
 * Local only — no host download.
 */
export async function parseSlicedObjectsFile(file: File): Promise<ParseSlicedObjectsResult> {
  const format = detectFormat(file.name);
  const buffer = await file.arrayBuffer();

  if (format === "3mf") {
    return finish(await parse3mfArchive(buffer), "3mf");
  }

  if (format === "bgcode") {
    const ascii = extractAsciiChunks(new Uint8Array(buffer));
    return finish(parseGcodeObjectText(ascii), "bgcode");
  }

  // .gcode / .gco / unknown — decode as text
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  return finish(parseGcodeObjectText(text), format === "unknown" ? "gcode" : format);
}
