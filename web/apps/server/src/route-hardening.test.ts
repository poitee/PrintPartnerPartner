import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSelfHostPorts } from "./adapters/self-host/index.js";

async function makeApp(dir: string) {
  process.env.PRINT_PARTNER_DATA_DIR = dir;
  delete process.env.PRINT_PARTNER_API_KEY;
  const config = loadConfig();
  const ports = createSelfHostPorts(dir);
  await ports.db.connect();
  const app = await buildApp(config, ports);
  return { app, ports };
}

function multipartZip(buffer: Buffer, filename = "archive.zip") {
  const boundary = "----pp-test-boundary";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, buffer, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("path traversal hardening", () => {
  afterEach(() => {
    delete process.env.PRINT_PARTNER_DATA_DIR;
  });

  it("GET /manifest-registry/:slug rejects traversal slugs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-manifest-slug-"));
    const { app, ports } = await makeApp(dir);

    for (const slug of [
      "..%2F..%2F..%2Fetc%2Fpasswd",
      "..%2Fregistry-index",
      "%2e%2e%2f%2e%2e%2fsecrets",
    ]) {
      const res = await app.inject({ method: "GET", url: `/manifest-registry/${slug}` });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { detail: string }).detail).toBe("Manifest not found");
    }

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("POST /sources/:id/upload-zip extracts a safe archive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-upload-zip-"));
    const { app, ports } = await makeApp(dir);

    const created = await app.inject({
      method: "POST",
      url: "/sources",
      payload: { name: "Kit", url: "https://github.com/a/b" },
    });
    expect(created.statusCode).toBe(200);
    const sourceId = (created.json() as { id: number }).id;

    const zip = new AdmZip();
    zip.addFile("part.stl", Buffer.from("solid part"));
    const { payload, headers } = multipartZip(zip.toBuffer());

    const res = await app.inject({
      method: "POST",
      url: `/sources/${sourceId}/upload-zip`,
      payload,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(existsSync(join(dir, "sources", String(sourceId), "files", "part.stl"))).toBe(true);

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("POST /sources/:id/upload-zip rejects malicious zip-slip archives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-upload-zipslip-"));
    const { app, ports } = await makeApp(dir);

    const created = await app.inject({
      method: "POST",
      url: "/sources",
      payload: { name: "Kit", url: "https://github.com/a/b" },
    });
    const sourceId = (created.json() as { id: number }).id;

    // adm-zip sanitizes names in addFile, so force a hostile entry name afterwards.
    const zip = new AdmZip();
    zip.addFile("placeholder-entry", Buffer.from("pwned"));
    zip.getEntries()[0]!.entryName = "../../../evil.txt";
    const { payload, headers } = multipartZip(zip.toBuffer());

    const res = await app.inject({
      method: "POST",
      url: `/sources/${sourceId}/upload-zip`,
      payload,
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { detail: string }).detail).toMatch(/escapes extraction directory/);
    expect(existsSync(join(dir, "evil.txt"))).toBe(false);

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("removed the path-based import endpoints", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-removed-routes-"));
    const { app, ports } = await makeApp(dir);

    // Path-based archive import was only used by the retired desktop client.
    const archive = await app.inject({
      method: "POST",
      url: "/sources/1/import-archive",
      payload: { path: "/etc/hosts" },
    });
    expect(archive.statusCode).toBe(404);

    // repos.txt import no longer reads server-side files; text is required.
    const repos = await app.inject({
      method: "POST",
      url: "/sources/import-repos-txt",
      payload: { path: "/etc/hosts" },
    });
    expect(repos.statusCode).toBe(400);
    expect((repos.json() as { detail: string }).detail).toBe("text is required");

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
