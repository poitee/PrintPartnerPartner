import { describe, expect, it } from "vitest";
import { buildDigestAuthorization, parseWwwAuthenticate } from "./digest-auth.js";

describe("digest-auth", () => {
  it("parses WWW-Authenticate Digest challenges", () => {
    const header =
      'Digest realm="Printer API", nonce="abc123", qop="auth", algorithm=MD5, opaque="xyz"';
    expect(parseWwwAuthenticate(header)).toEqual({
      realm: "Printer API",
      nonce: "abc123",
      qop: "auth",
      algorithm: "MD5",
      opaque: "xyz",
    });
  });

  it("builds a Digest Authorization header with qop=auth", () => {
    const authorization = buildDigestAuthorization({
      username: "maker",
      password: "secret",
      method: "GET",
      uri: "/api/v1/status",
      challenge: {
        realm: "Printer API",
        nonce: "n1",
        qop: "auth",
        algorithm: "MD5",
      },
      nc: 1,
    });
    expect(authorization).toMatch(/^Digest /);
    expect(authorization).toContain('username="maker"');
    expect(authorization).toContain('realm="Printer API"');
    expect(authorization).toContain('nonce="n1"');
    expect(authorization).toContain('uri="/api/v1/status"');
    expect(authorization).toContain("qop=auth");
    expect(authorization).toContain("nc=00000001");
    expect(authorization).toContain("response=");
  });
});
