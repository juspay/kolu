/**
 * Go-style duration strings, byte-compatible with the commit-status
 * descriptions justci posted (`4s`, `58s`, `1m0s`, `3m26s`, `48m34s`).
 * justci is a Go consumer of `time.Duration.String()` truncated to seconds;
 * branch-protection tooling and humans already parse these, so odu keeps the
 * format — including the zero-pad forms `1m0s` and `1h0m0s`.
 */
export function formatGoDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}
