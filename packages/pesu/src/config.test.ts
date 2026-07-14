import { describe, expect, it } from "vitest";
import {
  DEFAULT_COORDINATOR_TITLE,
  DEFAULT_PORT,
  isOperatorEmail,
  loadConfig,
} from "./config.ts";

const full = {
  PESU_SIGNING_SECRET: "s3cret",
  PESU_JWT_TOKEN: "jwt.token.here",
  XYNE_BASE_URL: "https://xs.example.com/",
  PESU_OPERATOR_ALLOWLIST: "srid@srid.ca",
};

describe("loadConfig — fail-fast, no fallbacks", () => {
  it("loads a complete env and strips a trailing slash from the base URL", () => {
    const cfg = loadConfig(full);
    expect(cfg.signingSecret).toBe("s3cret");
    expect(cfg.jwtToken).toBe("jwt.token.here");
    expect(cfg.xyneBaseUrl).toBe("https://xs.example.com");
    expect(cfg.operatorEmails).toEqual(["srid@srid.ca"]);
  });

  it("applies defaults for the optional port and coordinator title", () => {
    const cfg = loadConfig(full);
    expect(cfg.port).toBe(DEFAULT_PORT);
    expect(cfg.coordinatorTitle).toBe(DEFAULT_COORDINATOR_TITLE);
  });

  it("honours PESU_PORT and PESU_COORDINATOR_TITLE when set", () => {
    const cfg = loadConfig({
      ...full,
      PESU_PORT: "9999",
      PESU_COORDINATOR_TITLE: "scratch-coord",
    });
    expect(cfg.port).toBe(9999);
    expect(cfg.coordinatorTitle).toBe("scratch-coord");
  });

  it("lower-cases and splits a multi-operator allowlist", () => {
    const cfg = loadConfig({
      ...full,
      PESU_OPERATOR_ALLOWLIST: "Srid@Srid.ca, Other@Example.com ",
    });
    expect(cfg.operatorEmails).toEqual(["srid@srid.ca", "other@example.com"]);
  });

  it.each([
    "PESU_SIGNING_SECRET",
    "PESU_JWT_TOKEN",
    "XYNE_BASE_URL",
    "PESU_OPERATOR_ALLOWLIST",
  ])("throws loudly when %s is missing", (missing) => {
    const env: Record<string, string | undefined> = { ...full };
    delete env[missing];
    expect(() => loadConfig(env)).toThrow(missing);
  });

  it("throws when a required var is present but empty", () => {
    expect(() => loadConfig({ ...full, PESU_SIGNING_SECRET: "   " })).toThrow(
      "PESU_SIGNING_SECRET",
    );
  });

  it("rejects an out-of-range PESU_PORT", () => {
    expect(() => loadConfig({ ...full, PESU_PORT: "70000" })).toThrow(
      "PESU_PORT",
    );
    expect(() => loadConfig({ ...full, PESU_PORT: "not-a-number" })).toThrow(
      "PESU_PORT",
    );
  });
});

describe("isOperatorEmail", () => {
  const allow = ["srid@srid.ca"];
  it("matches case-insensitively", () => {
    expect(isOperatorEmail(allow, "SRID@srid.ca")).toBe(true);
    expect(isOperatorEmail(allow, " srid@srid.ca ")).toBe(true);
  });
  it("rejects a non-operator and a null email", () => {
    expect(isOperatorEmail(allow, "someone@else.com")).toBe(false);
    expect(isOperatorEmail(allow, null)).toBe(false);
    expect(isOperatorEmail(allow, undefined)).toBe(false);
  });
});
