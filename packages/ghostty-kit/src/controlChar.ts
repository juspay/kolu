/** Ctrl+A…Z → the corresponding C0 byte. App-claimed chords must be
 *  filtered before this runs. */
export function controlChar(key: string): string | null {
  if (key.length !== 1) return null;
  const n = key.toLowerCase().charCodeAt(0) - 96;
  if (n < 1 || n > 26) return null;
  return String.fromCharCode(n);
}
