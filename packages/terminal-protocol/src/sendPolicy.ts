/**
 * The SEND policy — what bytes a named send actually writes to a terminal's
 * input, and which sends are refused outright.
 *
 * Four rules, and every one of them exists because getting it wrong fails
 * SILENTLY — a submit that never lands, or a send that reports success having
 * written nothing:
 *
 *   1. **Text XOR keys.** An Enter written in the same breath as the text races
 *      the driven TUI's paste debounce and is swallowed, leaving the prompt
 *      sitting unsent. There is no delay that fixes this — the caller cannot
 *      observe when the TUI settled — so the pair is a hard refusal rather than
 *      a warning, and submitting is its own separate send.
 *   2. **An unknown key name is a refusal, never a no-op.** Encoding happens up
 *      front so nothing reaches the terminal on a half-legal request.
 *   3. **Auto bracketed paste.** Multiline text, or a payload that arrived as a
 *      BLOCK from a stream (a file, a pipe), is wrapped so the agent's input box
 *      takes it as ONE block instead of firing a half-written prompt at every
 *      `\n`. A single-line argument types literally. An explicit override wins.
 *   4. **An empty payload is a refusal, never a 0-byte "sent" — in EITHER
 *      content shape.** A write of nothing that answers "ok" is
 *      indistinguishable, to the loop above it, from a send that worked — so an
 *      empty `--file`, an empty pipe, a `kolu send <id> ""`, a
 *      `lifecycle_sendInput { text: "" }`, and an empty KEY LIST all fail loud
 *      instead of hiding whatever produced the empty payload. Emptiness is a
 *      property of the CONTENT, decidable wherever the content is, which is why
 *      it belongs beside the other three and not on one face: it used to live on
 *      argv only, and the MCP face answered the identical intent with success.
 *      The keys half is the same lesson one shape over — it was the text branch
 *      alone that checked, while `{ kind: "keys", names: [] }` planned a
 *      "successful" write of nothing; that both of today's faces happen to gate
 *      it upstream is a property of today's callers, not of this policy.
 *
 * It lives here, in the package that already owns the named-key grammar and the
 * paste delimiters these rules are ABOUT, because it was implemented twice —
 * once for `kolu send`, once for the MCP face's `lifecycle_sendInput` — with
 * near-identical prose in both. Those are not two vocabularies; they are one
 * policy about writing to a driven TUI, and two copies means the next refinement
 * lands on one face while a driver that switches from argv to MCP gets a
 * different answer to the same intent — which is not hypothetical: rule 4 was on
 * argv alone, and the MCP face wrote 0 bytes and said "ok".
 *
 * What is NOT here: where the text came from (`--file` / stdin / an argv
 * positional / an MCP field) and what a face calls its own flags. The first is
 * each face's own source resolution — rule 4 only QUOTES the face's name for the
 * source it read, handed in with the content; the second is
 * {@link SendVocabulary}, passed in, so a refusal names the thing the caller
 * actually typed.
 */

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
 *  trailer or a structured frame). `paste` is the EFFECTIVE value — resolved
 *  from the override and the text's shape — not the raw flag. */
export interface SendPlan {
  /** The single payload — EITHER the (optionally bracketed) text OR the encoded
   *  keys, never both. */
  readonly write: string;
  /** Total UTF-8 bytes of the write, paste markers included — the honest wire
   *  total (`.length` counts UTF-16 units, which lies for non-ASCII). */
  readonly bytes: number;
  readonly paste: boolean;
}

/** The content a send carries — EITHER text OR keys, never both. A
 *  discriminated union, so the forbidden pair is unspellable at this boundary
 *  and there is no precedence branch to guess at; {@link sendShapeRefusal} is
 *  what turns a caller's raw both-given request into that refusal. */
export type SendContent =
  | {
      readonly kind: "text";
      /** The payload. EMPTY is a refusal (rule 4), decided by {@link encodeSend}
       *  rather than by each face — one face used to check and the other did
       *  not. */
      readonly text: string;
      /** How a refusal NAMES where this text came from — `--file "brief.md"`,
       *  `piped stdin`, `positional text`, or the MCP face's one `text` field.
       *  Provenance is each face's own (see the header), so the label travels
       *  WITH the content instead of being re-derived from a source model this
       *  module does not have. */
      readonly sourceLabel: string;
      /** The explicit override, or `undefined` for auto. */
      readonly paste: boolean | undefined;
      /** The text arrived as a BLOCK from a stream — a file, a pipe — not as a
       *  literal single-line argument, so it auto-pastes even when single-line
       *  (a file is one payload, not a line typed at a prompt). */
      readonly fromStream: boolean;
    }
  | { readonly kind: "keys"; readonly names: readonly string[] };

/** A planned write, or the sentence saying why there is none. */
export type SendEncoding =
  | { readonly kind: "plan"; readonly plan: SendPlan }
  | { readonly kind: "refused"; readonly message: string };

/** Rule 1, decided from the SHAPE alone — which is why it is its own function:
 *  a face knows "there is a text source" and "there are keys" before it has read
 *  the text, and refusing there is what keeps a `--file` that would be rejected
 *  anyway from being opened first. */
export function sendShapeRefusal(
  shape: { readonly hasText: boolean; readonly hasKeys: boolean },
  vocab: SendVocabulary,
): string | undefined {
  if (!shape.hasText || !shape.hasKeys) return undefined;
  return `text and ${vocab.keyName} can't be combined in one send — a same-breath Enter is raced by the TUI's paste debounce and silently dropped. Send the text, observe the terminal settle, then submit as its own send:\n${vocab.submitRitual}`;
}

/** UTF-8 wire length. `TextEncoder` rather than `Buffer.byteLength` so this
 *  module stays importable from every consumer of `@kolu/terminal-protocol`,
 *  browser included. */
const utf8Bytes = (text: string): number =>
  new TextEncoder().encode(text).length;

/** Rules 2, 3 and 4: encode the write, or say why there is none. Total over its
 *  legal input — no submit Enter is ever synthesized, and keys are never
 *  pasted. */
export function encodeSend(
  content: SendContent,
  vocab: SendVocabulary,
): SendEncoding {
  if (content.kind === "keys") {
    // Rule 4, the KEYS shape of it. An empty name list runs the loop zero times
    // and would plan a write of "" — the same 0-byte "sent" the text branch
    // refuses, and just as indistinguishable from a send that landed. Today's
    // two faces each gate it before they get here (`kolu send` on
    // `args.key.length > 0`, the MCP face by passing exactly one name), but this
    // module is exported so a THIRD consumer need not re-derive the policy —
    // and a caller that never sees the refusal is exactly the caller that would
    // otherwise get the silent no-op.
    if (content.names.length === 0) {
      return {
        kind: "refused",
        message: `nothing to send — ${vocab.keyName} named no keys. A 0-byte send is a no-op that would hide whatever produced the empty key list; pass a name (${ACCEPTED_KEY_NAMES}) or a chord (C-c, M-b).`,
      };
    }
    let keyData = "";
    for (const name of content.names) {
      const bytes = encodeKey(name);
      if (bytes === undefined) {
        return {
          kind: "refused",
          message: `unknown ${vocab.keyName} ${JSON.stringify(name)} — use a name (${ACCEPTED_KEY_NAMES}) or a chord (C-c, M-b).`,
        };
      }
      keyData += bytes;
    }
    return {
      kind: "plan",
      plan: { write: keyData, bytes: utf8Bytes(keyData), paste: false },
    };
  }

  // Rule 4, before the paste fold: an empty payload wrapped in paste markers is
  // still nothing to submit, and the markers would make the byte count lie about
  // it. The sentence names the caller's OWN source and key flag, so it reads the
  // same whether the empty text arrived as `--file ""` or as `{ text: "" }`.
  if (content.text.length === 0) {
    return {
      kind: "refused",
      message: `nothing to send — ${content.sourceLabel} is empty. A 0-byte send is a no-op that would hide whatever produced the empty payload; pass non-empty text, or use ${vocab.keyName} to send a key.`,
    };
  }

  const paste =
    content.paste ?? (content.fromStream || content.text.includes("\n"));
  const write = paste ? wrapBracketedPaste(content.text) : content.text;
  return { kind: "plan", plan: { write, bytes: utf8Bytes(write), paste } };
}
