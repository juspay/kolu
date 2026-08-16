/** Decode an OSC 52 payload the engine already extracted. `?` is a clipboard
 *  query; anything else is base64 to copy. */

export type Osc52Action =
  | { kind: "copy"; text: string }
  | { kind: "query" }
  | { kind: "invalid" };

export function decodeOsc52Payload(payload: string): Osc52Action {
  if (payload === "?") return { kind: "query" };
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return { kind: "copy", text: new TextDecoder().decode(bytes) };
  } catch {
    return { kind: "invalid" };
  }
}
