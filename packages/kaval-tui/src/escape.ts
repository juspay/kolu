import { createPasteTracker } from "@kolu/terminal-protocol";

export type EscapeEvent =
  | { kind: "forward"; data: Buffer }
  | { kind: "detach" }
  | { kind: "help" };

export interface EscapeScanner {
  feed(chunk: Buffer): EscapeEvent[];
}

const CR = 0x0d;
const LF = 0x0a;
const DETACH_BYTE = ".".charCodeAt(0);
const HELP_BYTE = "?".charCodeAt(0);

export function isValidEscapeChar(s: string): boolean {
  return /^[\x20-\x7e]$/.test(s);
}

export function createEscapeScanner(escapeChar = "~"): EscapeScanner {
  const escByte = escapeChar.charCodeAt(0);

  let atLineStart = true;
  let pendingEscape = false;
  const paste = createPasteTracker();

  return {
    feed(chunk: Buffer): EscapeEvent[] {
      const events: EscapeEvent[] = [];
      const out: number[] = [];
      const flush = (): void => {
        if (out.length > 0) {
          events.push({ kind: "forward", data: Buffer.from(out) });
          out.length = 0;
        }
      };
      const forward = (b: number): void => {
        out.push(b);
        atLineStart = b === CR || b === LF;
        paste.step(b);
      };

      for (const b of chunk) {
        if (paste.inPaste) {
          out.push(b);
          paste.step(b);
          if (!paste.inPaste) {
            atLineStart = false;
          }
          continue;
        }
        if (pendingEscape) {
          pendingEscape = false;
          if (b === escByte) {
            forward(escByte);
          } else if (b === DETACH_BYTE) {
            flush();
            events.push({ kind: "detach" });
          } else if (b === HELP_BYTE) {
            flush();
            events.push({ kind: "help" });
            atLineStart = true;
          } else {
            forward(escByte);
            forward(b);
          }
          continue;
        }
        if (atLineStart && b === escByte) {
          pendingEscape = true;
          continue;
        }
        forward(b);
      }
      flush();
      return events;
    },
  };
}
