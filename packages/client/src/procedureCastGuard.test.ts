import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGuardSourceFiles } from "./architectureGuardSources.testlib";

const CLIENT_SRC = dirname(fileURLToPath(import.meta.url));

const RPC_CAST_RE = /\.rpc\s+as\s+\w/;

const CONTRACT_CLIENT_COPY_RE = /ContractRouterClient<\s*typeof\s/;

function scan(text: string, re: RegExp, label: string): string[] {
  const g = new RegExp(re.source, "g");
  const hits: string[] = [];
  for (let m = g.exec(text); m !== null; m = g.exec(text)) {
    const line = text.slice(0, m.index).split("\n").length;
    const snippet = m[0].replace(/\s+/g, " ").trim();
    hits.push(`${label}:${line}: ${snippet}`);
  }
  return hits;
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const file of listGuardSourceFiles(CLIENT_SRC)) {
    const text = readFileSync(file, "utf8");
    const rel = file.replace(`${CLIENT_SRC}/`, "");
    for (const hit of scan(text, RPC_CAST_RE, `${rel} — .rpc cast`))
      violations.push(hit);
    for (const hit of scan(
      text,
      CONTRACT_CLIENT_COPY_RE,
      `${rel} — copied procedure shape`,
    ))
      violations.push(hit);
  }
  return violations;
}

describe("procedure cast guard — no declared Surface procedure is reached by casting `.rpc` or copied as a client-shape alias (SRT-PR2)", () => {
  it("packages/client/src has no `.rpc as <T>` cast and no `ContractRouterClient<typeof …Surface.contract>` alias — declared procedures ride the bound `procedures` face; bare `.rpc` (reserved/link-root) stays fine", () => {
    expect(findViolations()).toEqual([]);
  });

  it("catches the multiline forms a line-split scan would miss (the removed alias / a wrapped cast)", () => {
    const multilineAlias =
      "type PadiRpc = ContractRouterClient<\n  typeof padiSurface.contract\n>;";
    expect(scan(multilineAlias, CONTRACT_CLIENT_COPY_RE, "fixture")).toEqual([
      "fixture:1: ContractRouterClient< typeof",
    ]);

    const multilineCast = "const p = entry.rpc\n  as PadiRpc;";
    expect(scan(multilineCast, RPC_CAST_RE, "fixture")).toEqual([
      "fixture:1: .rpc as P",
    ]);
  });
});
