import { wrapBracketedPaste } from "./bracketedPaste.ts";
import { ACCEPTED_KEY_NAMES, encodeKey } from "./keyInput.ts";

/** How one face SPELLS the policy's two moving parts, so a refusal names what
 *  the caller typed rather than the other face's word for it. */
export interface SendVocabulary {
  /** This face's word for the key input — `--key` for argv, `key` for MCP. */
  readonly keyName: string;
  /** This face's own settle-then-submit ritual, quoted under the text+keys
   *  refusal — the commands that caller can actually run. */
  readonly submitRitual: string;
}

/** The single write a send issues, plus what it actually did (for a human
 *  trailer or a structured frame). */
export interface SendPlan {
  /** The single payload — EITHER the (optionally bracketed) text OR the encoded
   *  keys, never both. */
  readonly write: string;
  /** Total UTF-8 bytes of the write, paste markers included — the honest wire
   *  total (`.length` counts UTF-16 units, which lies for non-ASCII). */
  readonly bytes: number;
  /** The EFFECTIVE paste decision — the override resolved against the text's
   *  shape, not the raw flag. */
  readonly paste: boolean;
}

/** The content a send carries — EITHER text OR keys, never both;
 *  {@link sendShapeRefusal} turns a caller's raw both-given request into that
 *  refusal. */
export type SendContent =
  | {
      readonly kind: "text";
      /** The payload. EMPTY is a refusal, decided here rather than by each
       *  face. */
      readonly text: string;
      /** How a refusal NAMES where this text came from — `--file "brief.md"`,
       *  `piped stdin`, `positional text`, or the MCP face's one `text` field. */
      readonly sourceLabel: string;
      /** The explicit override, or `undefined` for auto. */
      readonly paste: boolean | undefined;
      /** The text arrived as a BLOCK from a stream — a file, a pipe — not as a
       *  literal single-line argument. */
      readonly fromStream: boolean;
    }
  | { readonly kind: "keys"; readonly names: readonly string[] };

/** The sentence saying why a send writes nothing. */
interface SendRefusal {
  readonly kind: "refused";
  readonly message: string;
}

/** A planned write, or the sentence saying why there is none. */
export type SendEncoding =
  | { readonly kind: "plan"; readonly plan: SendPlan }
  | SendRefusal;

type SendText = Extract<SendContent, { readonly kind: "text" }>;

/** Text and keys in one send: the same-breath Enter races the driven TUI's
 *  paste debounce and is swallowed. Decided from the SHAPE alone, so a `--file`
 *  that would be rejected anyway is never opened. */
export function sendShapeRefusal(
  shape: { readonly hasText: boolean; readonly hasKeys: boolean },
  vocab: SendVocabulary,
): string | undefined {
  if (!shape.hasText || !shape.hasKeys) return undefined;
  return `text and ${vocab.keyName} can't be combined in one send — a same-breath Enter is raced by the TUI's paste debounce and silently dropped. Send the text, observe the terminal settle, then submit as its own send:\n${vocab.submitRitual}`;
}

/** A 0-byte write that answers "ok" is indistinguishable from a send that
 *  landed, in EITHER content shape. */
const emptyPayloadRefusal = (
  content: SendContent,
  vocab: SendVocabulary,
): SendRefusal | undefined => {
  if (content.kind === "keys") {
    if (content.names.length > 0) return undefined;
    return {
      kind: "refused",
      message: `nothing to send — ${vocab.keyName} named no keys. A 0-byte send is a no-op that would hide whatever produced the empty key list; pass a name (${ACCEPTED_KEY_NAMES}) or a chord (C-c, M-b).`,
    };
  }
  if (content.text.length > 0) return undefined;
  return {
    kind: "refused",
    message: `nothing to send — ${content.sourceLabel} is empty. A 0-byte send is a no-op that would hide whatever produced the empty payload; pass non-empty text, or use ${vocab.keyName} to send a key.`,
  };
};

const unknownKeyRefusal = (
  name: string,
  vocab: SendVocabulary,
): SendRefusal => ({
  kind: "refused",
  message: `unknown ${vocab.keyName} ${JSON.stringify(name)} — use a name (${ACCEPTED_KEY_NAMES}) or a chord (C-c, M-b).`,
});

/** The whole run of keys, or the refusal for the first name that encodes to
 *  nothing — never a partial write. */
const keyWrite = (
  names: readonly string[],
  vocab: SendVocabulary,
): string | SendRefusal => {
  let data = "";
  for (const name of names) {
    const bytes = encodeKey(name);
    if (bytes === undefined) return unknownKeyRefusal(name, vocab);
    data += bytes;
  }
  return data;
};

/** Multiline text, or a payload that arrived as a BLOCK from a stream, is
 *  wrapped so the agent's input box takes it as ONE block instead of firing a
 *  half-written prompt at every `\n`. An explicit override wins. */
const shouldAutoPaste = (content: SendText): boolean =>
  content.paste ?? (content.fromStream || content.text.includes("\n"));

/** UTF-8 wire length, via `TextEncoder` so this module stays importable in a
 *  browser. */
const utf8Bytes = (text: string): number =>
  new TextEncoder().encode(text).length;

/** Encode the write, or say why there is none. Total over its legal input — no
 *  submit Enter is ever synthesized, and keys are never pasted. */
export function encodeSend(
  content: SendContent,
  vocab: SendVocabulary,
): SendEncoding {
  const empty = emptyPayloadRefusal(content, vocab);
  if (empty !== undefined) return empty;

  if (content.kind === "keys") {
    const write = keyWrite(content.names, vocab);
    if (typeof write !== "string") return write;
    return {
      kind: "plan",
      plan: { write, bytes: utf8Bytes(write), paste: false },
    };
  }

  const paste = shouldAutoPaste(content);
  const write = paste ? wrapBracketedPaste(content.text) : content.text;
  return { kind: "plan", plan: { write, bytes: utf8Bytes(write), paste } };
}
