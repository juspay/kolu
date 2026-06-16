import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSshConfigHosts } from "./sshConfig.ts";

describe("listSshConfigHosts", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-sshcfg-"));
    configPath = path.join(dir, "config");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (text: string) => fs.writeFileSync(configPath, text);

  it("returns the dialable Host aliases in file order", () => {
    write(
      [
        "Host prod",
        "  HostName 10.0.0.1",
        "  User deploy",
        "",
        "Host build-box",
        "  HostName build.internal",
      ].join("\n"),
    );
    expect(listSshConfigHosts(configPath)).toEqual(["prod", "build-box"]);
  });

  it("expands multiple aliases on one Host line", () => {
    write("Host prod prod-old prod.example.com\n  HostName 10.0.0.1\n");
    expect(listSshConfigHosts(configPath)).toEqual([
      "prod",
      "prod-old",
      "prod.example.com",
    ]);
  });

  it("skips pattern, negation, and catch-all scopes", () => {
    write(
      [
        "Host *",
        "  ServerAliveInterval 60",
        "Host *.internal",
        "Host real",
        "Host build !staging",
        "Host web?",
      ].join("\n"),
    );
    // `*`, `*.internal`, `!staging`, and `web?` are scopes/patterns, not hosts;
    // `real` and `build` are the only dialable names.
    expect(listSshConfigHosts(configPath)).toEqual(["real", "build"]);
  });

  it("does not mistake HostName for a Host line", () => {
    write("Host alpha\n  HostName host-should-not-appear\n");
    expect(listSshConfigHosts(configPath)).toEqual(["alpha"]);
  });

  it("accepts the `Host=x` and `Host = x` equals forms", () => {
    write("Host=eq1\nHost = eq2\n");
    expect(listSshConfigHosts(configPath)).toEqual(["eq1", "eq2"]);
  });

  it("ignores comments and is case-insensitive on the keyword", () => {
    write("# Host commented\nHOST shouty\nhost quiet\n");
    expect(listSshConfigHosts(configPath)).toEqual(["shouty", "quiet"]);
  });

  it("dedupes a host that appears twice", () => {
    write("Host dup\nHost dup\n");
    expect(listSshConfigHosts(configPath)).toEqual(["dup"]);
  });

  it("returns [] for a missing config (the common fresh-machine case)", () => {
    expect(listSshConfigHosts(path.join(dir, "does-not-exist"))).toEqual([]);
  });
});
