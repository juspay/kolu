import { stripVTControlCharacters } from "node:util";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/g;

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function plainDiagnostic(text: string): string {
  return stripVTControlCharacters(text).replace(CONTROL_CHARACTERS, " ").trim();
}
