/** Replace home directory prefix with ~ for compact display. */
export function shortenCwd(cwd: string): string {
  // Heuristic: /home/<user>/... or /root/... → ~/...
  const shortened = cwd.replace(/^\/(home\/[^/]+|root)(\/|$)/, "~$2");
  return shortened || "~";
}
