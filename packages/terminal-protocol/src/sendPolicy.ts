/**
 * The SEND policy — what bytes a named send actually writes to a terminal's
 * input, and which sends are refused outright.
 *
 * Three rules, and all three exist because getting them wrong drops a
 * submit SILENTLY:
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
 *
 * It lives here, in the package that already owns the named-key grammar and the
 * paste delimiters these rules are ABOUT, because it was implemented twice —
 * once for `kolu send`, once for the MCP face's `lifecycle_sendInput` — with
 * near-identical prose in both. Those are not two vocabularies; they are one
 * policy about a TUI's paste debounce, and two copies means the next refinement
 * lands on one face while a driver that switches from argv to MCP gets a
 * different answer to the same intent.
 *
 * What is NOT here: where the text came from (`--file` / stdin / an argv
 * positional / an MCP field) and what a face calls its own flags. The first is
 * each face's own source resolution; the second is {@link SendVocabulary},
 * passed in, so a refusal names the thing the caller actually typed.
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
      /** NON-EMPTY by the caller's construction: a face refuses an empty payload
       *  first, with an error that NAMES the source it read. A second,
       *  source-blind guard here could only produce a worse message. */
      readonly text: string;
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
const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** Rules 2 and 3: encode the write. Total over its legal input — no submit Enter
 *  is ever synthesized, and keys are never pasted. */
export function encodeSend(
  content: SendContent,
  vocab: SendVocabulary,
): SendEncoding {
  if (content.kind === "keys") {
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

  const paste =
    content.paste ?? (content.fromStream || content.text.includes("\n"));
  const write = paste ? wrapBracketedPaste(content.text) : content.text;
  return { kind: "plan", plan: { write, bytes: utf8Bytes(write), paste } };
}
