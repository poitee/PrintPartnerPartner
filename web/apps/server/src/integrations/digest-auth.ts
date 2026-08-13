import { createHash, randomBytes } from "node:crypto";

/** Parse a WWW-Authenticate Digest challenge into key/value params. */
export function parseWwwAuthenticate(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const match = /^\s*Digest\s+(.+)$/i.exec(header.trim());
  if (!match) return params;
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(match[1]!)) !== null) {
    params[m[1]!] = m[2] ?? m[3] ?? "";
  }
  return params;
}

function md5(value: string): string {
  // HTTP Digest Auth (RFC 7616 / PrusaLink) requires MD5 for HA1/HA2 — not password storage.
  return createHash("md5").update(value).digest("hex");
}

/** Build an Authorization: Digest … header for an HTTP Digest challenge (MD5 / auth). */
export function buildDigestAuthorization(opts: {
  username: string;
  password: string;
  method: string;
  uri: string;
  challenge: Record<string, string>;
  nc?: number;
}): string {
  const { username, password, method, uri, challenge } = opts;
  const realm = challenge.realm ?? "";
  const nonce = challenge.nonce ?? "";
  const qopRaw = challenge.qop ?? "";
  const qop = qopRaw.split(",")[0]?.trim() || undefined;
  const opaque = challenge.opaque;
  const algorithm = (challenge.algorithm ?? "MD5").toUpperCase();
  if (algorithm !== "MD5" && algorithm !== "MD5-SESS") {
    throw new Error(`Unsupported digest algorithm: ${algorithm}`);
  }

  let ha1 = md5(`${username}:${realm}:${password}`);
  const cnonce = randomBytes(8).toString("hex");
  if (algorithm === "MD5-SESS") {
    ha1 = md5(`${ha1}:${nonce}:${cnonce}`);
  }
  const ha2 = md5(`${method}:${uri}`);
  const nc = String(opts.nc ?? 1).padStart(8, "0");
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `Digest username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (qop) {
    parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  }
  if (opaque) parts.push(`opaque="${opaque}"`);
  parts.push(`algorithm=${algorithm}`);
  return parts.join(", ");
}
