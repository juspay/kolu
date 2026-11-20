export type HashRead =
  | {
      readonly kind: "path";
      readonly segments: ReadonlyArray<string>;
      readonly query: string;
    }
  | { readonly kind: "empty" }
  | { readonly kind: "bad"; readonly reason: string };

export function hashSegments(hash: string): HashRead {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const at = raw.indexOf("?");
  const path = at === -1 ? raw : raw.slice(0, at);
  const query = at === -1 ? "" : raw.slice(at + 1);

  if (path === "" || path === "/") return { kind: "empty" };

  const parts = path.split("/");
  if (parts[0] === "") parts.shift();
  if (parts.length === 0) return { kind: "empty" };
  if (parts.some((one) => one === ""))
    return {
      kind: "bad",
      reason: "empty path segment (a repeated or trailing slash)",
    };
  try {
    return {
      kind: "path",
      segments: parts.map((one) => decodeURIComponent(one)),
      query,
    };
  } catch {
    return { kind: "bad", reason: "malformed URL-encoding in the path" };
  }
}
