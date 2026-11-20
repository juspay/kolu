export function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

export function isCrossOriginHttpUrl(url: URL | null, origin: string): boolean {
  return url !== null && url.origin !== origin;
}

export function isDeepLinkHash(hash: string): boolean {
  return hash.startsWith("#/");
}
