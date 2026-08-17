/**
 * `resolveSendInputData` — the text-XOR-key matrix and the key grammar, pinned
 * apart from the wire (the tool handler is a thin sendInput call over this).
 */
import { ToolFailure } from "@kolu/surface-mcp";
import { sendShapeRefusal } from "@kolu/terminal-protocol";
import { describe, expect, it } from "vitest";
import { SubmitRefused } from "@kolu/padi/surface";
import {
  asToolFailure,
  resolveSendAction,
  resolveSendInputData,
  type SendRefusal,
} from "./sendInput.ts";

/** The shape gate reads a vocabulary only to WORD its refusal, never to decide
 *  which shapes it refuses — so any vocabulary probes the rule this face's
 *  `text-and-key` kind rests on. */
const ANY_VOCABULARY = { keyName: "key", submitRitual: "" };

const write = (args: { text?: string; key?: string }) =>
  resolveSendInputData(args).write;

/** The refusal a call raised, as the agent will receive it: `ToolFailure` is
 *  what `surface-mcp`'s `failFrom` turns into an `isError` result whose
 *  `structuredContent` IS this `detail`. Fails the test if the throw was an
 *  ordinary `Error` — a refusal that lost its detail on the way out is exactly
 *  the regression this file guards. */
const refusalFrom = (args: {
  text?: string;
  key?: string;
}): ToolFailure<SendRefusal> => {
  try {
    resolveSendInputData(args);
  } catch (e) {
    // `refuse` builds every one of these, and its return type is
    // `ToolFailure<SendRefusal>` — `instanceof` cannot carry the parameter, so
    // the assertion is stated here rather than lost to `Record<string, unknown>`.
    if (e instanceof ToolFailure) return e as ToolFailure<SendRefusal>;
    throw new Error(`expected a ToolFailure, got ${String(e)}`);
  }
  throw new Error("expected a refusal, but the args resolved");
};

describe("resolveSendInputData — the arg-legality matrix", () => {
  it("text resolves to itself when single-line", () => {
    expect(write({ text: "hello" })).toBe("hello");
  });

  it("multiline text is bracketed-paste wrapped (kaval-tui's auto rule)", () => {
    expect(write({ text: "a\nb" })).toBe("\x1b[200~a\nb\x1b[201~");
  });

  it("a named key resolves through the shared vocabulary", () => {
    expect(write({ key: "Enter" })).toBe("\r");
    expect(write({ key: "escape" })).toBe("\x1b");
    expect(write({ key: "C-c" })).toBe("\x03");
    expect(write({ key: "M-b" })).toBe("\x1bb");
  });

  it("text + key in one send is a LOUD error (the dropped-Enter trap)", () => {
    expect(() => resolveSendInputData({ text: "hi", key: "Enter" })).toThrow(
      /can't be combined/,
    );
  });

  it("an unknown key is a loud error, never a silent no-op", () => {
    expect(() => resolveSendInputData({ key: "Bogus" })).toThrow(/unknown key/);
  });

  it("neither text nor key is a loud error", () => {
    expect(() => resolveSendInputData({})).toThrow(/nothing to send/);
  });

  it("an EMPTY text is refused, not written as a 0-byte success", () => {
    // The divergence this closes: argv refuses an empty payload, and this face
    // used to encode a 0-byte write and answer `{ sent: { textBytes: 0 } }` —
    // so an agent whose prompt template rendered empty got "ok". The sentence is
    // the shared policy's, spoken in THIS face's vocabulary.
    expect(() => resolveSendInputData({ text: "" })).toThrow(
      /nothing to send — text is empty\./,
    );
    expect(() => resolveSendInputData({ text: "" })).toThrow(
      /use key to send a key/,
    );
  });
});

describe("resolveSendInputData — every refusal reaches the agent as DATA", () => {
  // A driver's recovery differs per refusal, and picking it out of the prose
  // means matching English. Each of the four rules therefore names itself in
  // `structuredContent`, beside — not instead of — the shared policy's sentence.
  it("text + key says which rule broke, so the driver knows to re-send as two calls", () => {
    const refusal = refusalFrom({ text: "hi", key: "Enter" });
    expect(refusal.detail).toEqual({ kind: "text-and-key" });
    expect(refusal.message).toMatch(/can't be combined/);
  });

  it("a rejected key rides along, so the driver sees the spelling it got wrong", () => {
    expect(refusalFrom({ key: "Bogus" }).detail).toEqual({
      kind: "key-refused",
      key: "Bogus",
    });
  });

  it("the KEYS branch's other shared refusal — an empty name list — is unreachable from this face", () => {
    // `encodeSend`'s keys branch refuses TWO things: an unknown name, and an
    // EMPTY name list. Both would collapse into `key-refused`, whose recovery
    // ("pick a name from the accepted list") fits only the first. This face
    // never reaches the second, structurally: it has one `key` field and passes
    // `names: [args.key]` inside `args.key !== undefined`, so the list is always
    // length 1. The emptiest key a caller can express is `""` — one unknown
    // NAME, which is the unknown-key rule and rides its spelling along.
    const empty = refusalFrom({ key: "" });
    expect(empty.detail).toEqual({ kind: "key-refused", key: "" });
    expect(empty.message).toMatch(/unknown key/);
    expect(empty.message).not.toMatch(/named no keys/);
  });

  it("`text-and-key` stays sound: the shape gate refuses exactly ONE of its four inputs", () => {
    // The one kind that names a REASON rather than a branch, and it is sound
    // only while `sendShapeRefusal` refuses exactly the both-supplied shape.
    // That condition was a paragraph; here it is a red test. If the shared gate
    // ever grows a second rule, this fails and the kind must split BEFORE it
    // ships mislabelled — which a per-branch test could never notice.
    const refusedShapes = [
      { hasText: false, hasKeys: false },
      { hasText: true, hasKeys: false },
      { hasText: false, hasKeys: true },
      { hasText: true, hasKeys: true },
    ].filter((shape) => sendShapeRefusal(shape, ANY_VOCABULARY) !== undefined);

    expect(refusedShapes).toEqual([{ hasText: true, hasKeys: true }]);
  });

  it("an empty text and no input at all are DIFFERENT refusals", () => {
    // Both mean "the driver's own prompt template rendered nothing", which is
    // precisely what a 0-byte "sent" used to hide — but one arrived as a field
    // and the other never arrived, and a driver fixes them in different places.
    expect(refusalFrom({ text: "" }).detail).toEqual({ kind: "text-refused" });
    expect(refusalFrom({}).detail).toEqual({ kind: "no-input" });
  });
});

describe("resolveSendInputData — the byte count the tool acknowledges", () => {
  it("is the encoder's own UTF-8 total, markers included, not a recount", () => {
    // `kolu send` reports `plan.bytes` for the identical send; recomputing it at
    // the handler is how the two faces come to disagree about the same write.
    // `.length` would say 1 for this one UTF-16 unit.
    expect(resolveSendInputData({ text: "é" }).bytes).toBe(2);
    const multiline = resolveSendInputData({ text: "a\nb" });
    expect(multiline.paste).toBe(true);
    // 3 bytes of text PLUS the two 6-byte bracketed-paste markers: what the
    // wire carried, not what the caller passed.
    expect(multiline.bytes).toBe(15);
  });
});

describe("resolveSendAction — write vs DELIVERY", () => {
  // The gates that decide which of padi's two members this call reaches. Both
  // refuse a field that would otherwise have been silently ignored, which is the
  // rule this repo applies everywhere a flag can be spelled and not honoured.
  const actionRefusalFrom = (args: {
    text?: string;
    key?: string;
    submit?: boolean;
    settleMs?: number;
  }): ToolFailure<SendRefusal> => {
    try {
      resolveSendAction(args);
    } catch (e) {
      if (e instanceof ToolFailure) return e as ToolFailure<SendRefusal>;
      throw new Error(`expected a ToolFailure, got ${String(e)}`);
    }
    throw new Error("expected a refusal, but the args resolved");
  };

  it("plain text is a WRITE — the raw member, unchanged", () => {
    expect(resolveSendAction({ text: "hi" })).toMatchObject({
      kind: "write",
      plan: { write: "hi" },
    });
  });

  it("text + submit is a DELIVERY, carrying the same planned bytes", () => {
    // The bytes must be identical to the write arm's: a submitted message and a
    // manually-sent one differ only in WHO presses Enter, never in what landed.
    expect(resolveSendAction({ text: "a\nb", submit: true })).toMatchObject({
      kind: "submit",
      plan: { write: "\x1b[200~a\nb\x1b[201~", paste: true },
      settleMs: undefined,
    });
  });

  it("submit without text is refused — a key press has nothing to submit", () => {
    expect(actionRefusalFrom({ key: "Enter", submit: true }).detail).toEqual({
      kind: "submit-without-text",
    });
    expect(actionRefusalFrom({ submit: true }).detail).toEqual({
      kind: "submit-without-text",
    });
  });

  it("settleMs without submit is refused, never ignored", () => {
    // A caller who tuned the window and saw it silently dropped would conclude
    // the tuning did nothing — true, and the least useful way to learn it.
    const refusal = actionRefusalFrom({ text: "hi", settleMs: 3000 });
    expect(refusal.detail).toEqual({
      kind: "settle-without-submit",
      field: "settleMs",
    });
    expect(refusal.message).toMatch(/add `submit: true`/);
  });

  it("submit: false is simply a write — there is no third state", () => {
    expect(resolveSendAction({ text: "hi", submit: false })).toMatchObject({
      kind: "write",
    });
  });

  it("the shared text/key rules still fire under submit", () => {
    // `resolveSendAction` adds gates; it must not become a second door that
    // bypasses the empty-payload and XOR rules the shared policy owns.
    expect(() => resolveSendAction({ text: "", submit: true })).toThrow(
      /nothing to send/,
    );
    expect(() =>
      resolveSendAction({ text: "hi", key: "Enter", submit: true }),
    ).toThrow(/can't be combined/);
  });
});

describe("resolveSendAction — timeoutMs obeys the same rule as settleMs", () => {
  it("rides the submit action, and is refused on a plain write", () => {
    expect(
      resolveSendAction({ text: "hi", submit: true, timeoutMs: 5000 }),
    ).toMatchObject({ kind: "submit", timeoutMs: 5000 });
    // The refusal NAMES the offending field rather than saying "one of the two",
    // so a driver fixes the call it actually made.
    try {
      resolveSendAction({ text: "hi", timeoutMs: 5000 });
      throw new Error("expected a refusal, but the args resolved");
    } catch (e) {
      expect((e as ToolFailure<SendRefusal>).detail).toEqual({
        kind: "settle-without-submit",
        field: "timeoutMs",
      });
    }
  });
});

describe("asToolFailure — the recovery a driver reads off a padi refusal", () => {
  const detailOf = (r: SubmitRefused): SendRefusal => {
    const failed = asToolFailure(r);
    if (!(failed instanceof ToolFailure))
      throw new Error(`expected a ToolFailure, got ${String(failed)}`);
    return failed.detail as SendRefusal;
  };

  it("a busy target at the SETTLE phase leaves text staged in the box", () => {
    expect(
      detailOf(
        new SubmitRefused({
          id: "t",
          phase: "settle",
          reason: "busy",
          waitedMs: 9,
        }),
      ),
    ).toMatchObject({ kind: "submit-refused", staged: true });
  });

  it("a GONE terminal stages nothing — there is no box left to hold it", () => {
    // The trap: `staged` used to be `phase === "settle"` alone, so a terminal
    // that DIED mid-delivery was reported as text-waiting-in-a-box. A driver
    // branching on it would send an Enter to a terminal that no longer exists,
    // and would refuse to re-dispatch the message for fear of doubling it — the
    // message is simply lost, and the field said the opposite.
    for (const phase of ["ready", "settle"] as const) {
      expect(
        detailOf(
          new SubmitRefused({ id: "t", phase, reason: "gone", waitedMs: 9 }),
        ),
      ).toMatchObject({
        kind: "submit-refused",
        reason: "gone",
        staged: false,
      });
    }
  });

  it("passes anything that is not a submit refusal straight through", () => {
    const other = new Error("something else entirely");
    expect(asToolFailure(other)).toBe(other);
  });
});
