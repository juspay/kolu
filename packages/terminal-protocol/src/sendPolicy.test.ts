/**
 * The send policy, pinned — the rules both faces (`kolu send`,
 * `lifecycle_sendInput`) now fold through, so a refinement to one can no longer
 * leave the other behind.
 *
 * The auto-paste decisions are the ones worth the most: getting them wrong is
 * silent. An unwrapped multiline prompt fires a half-written line at every
 * `\n`; an unwrapped file payload does the same; and pasting a single typed
 * argument would put paste markers into a shell that never asked for them.
 */

import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
} from "./bracketedPaste.ts";
import { describe, expect, it } from "vitest";
import {
  encodeSend,
  type SendVocabulary,
  sendShapeRefusal,
} from "./sendPolicy.ts";

const ARGV: SendVocabulary = {
  keyName: "--key",
  submitRitual: "  kolu send <id> --key Enter",
};
const MCP: SendVocabulary = {
  keyName: "key",
  submitRitual: "  lifecycle_sendInput { key: 'Enter' }",
};

describe("sendShapeRefusal — text XOR keys", () => {
  it("refuses the pair, naming the caller's OWN word for the key input", () => {
    expect(sendShapeRefusal({ hasText: true, hasKeys: true }, ARGV)).toContain(
      "text and --key can't be combined",
    );
    expect(sendShapeRefusal({ hasText: true, hasKeys: true }, MCP)).toContain(
      "text and key can't be combined",
    );
  });

  it("quotes the caller's own submit ritual, so the fix is runnable", () => {
    expect(sendShapeRefusal({ hasText: true, hasKeys: true }, ARGV)).toContain(
      ARGV.submitRitual,
    );
  });

  it("allows text alone, keys alone, and neither (each face names its own empty)", () => {
    expect(
      sendShapeRefusal({ hasText: true, hasKeys: false }, ARGV),
    ).toBeUndefined();
    expect(
      sendShapeRefusal({ hasText: false, hasKeys: true }, ARGV),
    ).toBeUndefined();
    expect(
      sendShapeRefusal({ hasText: false, hasKeys: false }, ARGV),
    ).toBeUndefined();
  });
});

describe("encodeSend — the paste decision", () => {
  const plan = (
    text: string,
    opts: { paste?: boolean | undefined; fromStream?: boolean } = {},
  ) => {
    const encoded = encodeSend(
      {
        kind: "text",
        text,
        paste: opts.paste,
        fromStream: opts.fromStream ?? false,
      },
      ARGV,
    );
    if (encoded.kind !== "plan") throw new Error(encoded.message);
    return encoded.plan;
  };

  it("types a single-line argument literally", () => {
    expect(plan("hello")).toEqual({ write: "hello", bytes: 5, paste: false });
  });

  it("pastes multiline text — one block, not a line per newline", () => {
    const p = plan("a\nb");
    expect(p.paste).toBe(true);
    expect(p.write).toBe(`${BRACKETED_PASTE_START}a\nb${BRACKETED_PASTE_END}`);
  });

  it("pastes a STREAM payload even when it is a single line", () => {
    // A `--file` / piped heredoc is one payload, not a line typed at a prompt.
    expect(plan("one line", { fromStream: true }).paste).toBe(true);
  });

  it("lets an explicit override win in BOTH directions", () => {
    expect(plan("a\nb", { paste: false }).paste).toBe(false);
    expect(plan("hello", { paste: true }).paste).toBe(true);
  });

  it("counts UTF-8 bytes, not UTF-16 units", () => {
    // `.length` would say 1 for this and lie to `--json`'s `bytes`.
    expect(plan("é").bytes).toBe(2);
  });
});

describe("encodeSend — keys", () => {
  it("encodes named keys in order and never pastes them", () => {
    const encoded = encodeSend({ kind: "keys", names: ["Escape"] }, ARGV);
    expect(encoded.kind).toBe("plan");
    if (encoded.kind !== "plan") return;
    expect(encoded.plan.paste).toBe(false);
    expect(encoded.plan.write).toBe("\x1b");
  });

  it("refuses an unknown name rather than sending a partial run of keys", () => {
    const encoded = encodeSend(
      { kind: "keys", names: ["Enter", "Nope"] },
      ARGV,
    );
    expect(encoded.kind).toBe("refused");
    if (encoded.kind !== "refused") return;
    expect(encoded.message).toContain('unknown --key "Nope"');
    // Same sentence, this face's word for the field.
    const mcpRefusal = encodeSend({ kind: "keys", names: ["Nope"] }, MCP);
    expect(mcpRefusal.kind === "refused" ? mcpRefusal.message : "").toContain(
      'unknown key "Nope"',
    );
  });
});
