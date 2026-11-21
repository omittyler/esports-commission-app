import { describe, it, expect } from "vitest";
import { portalOriginAllowed } from "../../cloudflare/portal-origin";
const origins = ["https://portal.example", "https://fallback.example"];
const request = (url: string, origin?: string) =>
  new Request(url, {
    method: "POST",
    headers: origin ? { Origin: origin } : {},
  });
describe("portal custom-domain origin checks", () => {
  it("accepts same-host requests on either explicitly configured origin", () => {
    for (const origin of origins)
      expect(
        portalOriginAllowed(request(`${origin}/portal/login`, origin), origins),
      ).toBe(true);
  });
  it("rejects missing, foreign and cross-host origins even when both hosts are trusted", () => {
    for (const origin of [
      undefined,
      "null",
      "https://attacker.example",
      "https://fallback.example",
    ])
      expect(
        portalOriginAllowed(
          request("https://portal.example/portal/register", origin),
          origins,
        ),
      ).toBe(false);
  });
  it("rejects unconfigured hosts and protocol/port lookalikes", () => {
    for (const origin of [
      "https://portal.example.attacker.test",
      "http://portal.example",
      "https://portal.example:8443",
    ])
      expect(
        portalOriginAllowed(request(`${origin}/portal/login`, origin), origins),
      ).toBe(false);
    expect(
      portalOriginAllowed(
        request(
          "https://portal.example/portal/login",
          "https://portal.example",
        ),
        [],
      ),
    ).toBe(false);
  });
});
