/** Git status → Tailwind color classes, shared by FileSearch and FileTree. */

/** Text color variant (for dots using `background-color: currentColor`). */
export const gitStatusTextColor: Record<string, string> = {
  modified: "text-yellow-400",
  added: "text-green-400",
  deleted: "text-red-400",
  renamed: "text-blue-400",
  untracked: "text-green-300",
};

/** Background color variant (for direct background dots). */
export const gitStatusBgColor: Record<string, string> = {
  modified: "bg-yellow-400",
  added: "bg-green-400",
  deleted: "bg-red-400",
  renamed: "bg-blue-400",
  untracked: "bg-green-300",
};
