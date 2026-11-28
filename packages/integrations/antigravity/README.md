# kolu-antigravity

**What it is**: kolu's integration with Google's [Antigravity CLI](https://antigravity.google/docs/cli/reference) (binary `agy`). It is a pure-observer agent adapter. It finds the conversation a terminal's `agy` is running and folds that conversation's transcript into an `AgentInfo` for kolu's tiles and dock. It also exports the transcript and tells `agent_say` how to talk to `agy`.

The evidence behind it is three captures of `agy` **1.5.19** on Linux, all on 2026-11-28. Google publishes no source for `agy`, so this package states only what those captures showed.

## What it owns

- **Which conversation** (`core.ts`). A running `agy` keeps the lock file of the conversation it has, `presence/<id>.lock`, open for as long as it has it. On Linux the adapter reads the names of the foreground `agy` process's open files (`kolu-io`'s `readOpenFileNames`). The lock among them is the answer: none for a fresh `agy`, the new one at once after `/clear` or `/fork`, and each of two `agy` in one folder holds only its own. The launch arguments are never trusted for this. Where open files cannot be read (macOS, a hidden `/proc`), the directory cache `cache/last_conversations.json` names the candidate instead. That fallback has known limits, listed under "Honest absences".
- **The state fold** (`deriveAntigravityState`). It reads the transcript's last line:

  | Last line | State |
  | --- | --- |
  | `USER_INPUT` | `thinking` |
  | `SYSTEM_MESSAGE` | `thinking` |
  | `GENERIC` (a tool's result), any status | `thinking` |
  | `PLANNER_RESPONSE` with `tool_calls` | `tool_use` |
  | `PLANNER_RESPONSE` without | `waiting` |

  A line of a kind not in this table publishes nothing. The model and the context size (`input_tokens + cache_read_tokens`) come from the newest model answer. The start time is the first line's `created_at`.
- **Waiting for the human** (`screen.ts`). `agy` asks permission while its tool-calling answer is already the transcript's last line, so the transcript reads `tool_use` throughout. The command-permission menu is recognised on screen and lifts `tool_use` to `awaiting_user`, promote only. Its marker is `agy`'s own fixed lines: the question, the first item under it, and the `esc to cancel` footer on the bottom line.
- **The title** (`readTitle`). It comes from the conversation's own `annotations/<id>.pbtxt`, one line `title:"…"`. It is `null` when that file is absent or holds anything else.
- **Watches**. A per-conversation watcher (`session-watcher.ts`) follows the transcript and the title file through `kolu-io`'s append-robust subscription. The process-wide wake watches `presence/` and `cache/`. It is installed only once `agy` is in a foreground or its directory exists.
- **Resume**: `agy --conversation=<id>`, the form `agy` prints on exit. The replayed flags are `--mode`, `--model`, `--effort`, `--agent`, `--add-dir`, `--project`, `--sandbox`, `--dangerously-skip-permissions` and `--remote-agent`. `agy` does not remember its flags across a resume, so kolu passes them again.
- **`agent_say`**: idle, one `Enter`. Working, one `Enter` queues the message as its own turn, sent when the running turn ends.
- **Transcript export** (`transcript.ts`): user words from the `USER_REQUEST` block, model answers, one tool call per `tool_calls` entry, and tool results. System lines are left out.

## What it reads, and what it never reads

It reads the transcript, the conversation's own annotations file, `cache/last_conversations.json`, names under `presence/`, and the link names in `/proc/<pid>/fd`.

It never reads the credential file in the same directory, the conversation databases, `history.jsonl`, the logs, or any process's environment. It never writes under `agy`'s directory.

## Honest absences

- **After `Esc`**, nothing is written, so the tile keeps showing "thinking" or "tool use" until the next prompt.
- **Other prompts**: only the command-permission menu is recognised as waiting for the human. Other prompts, and the trust question at start-up, are not.
- **macOS and hidden `/proc`**: the directory cache stands in, with its limits. It holds one conversation per directory, so a second `agy` there shows only that it is running. It keeps naming the old conversation after `/clear` until the next prompt. Its entries outlive the process. Nothing was captured on macOS.
- **A background command** is not shown. The turn has ended and the prompt takes input, so the tile reads `waiting`.
- **Task progress** is always `null`, because `agy` writes no checklist kolu can read.

## Testing

`KOLU_ANTIGRAVITY_DIR` points the whole tree at a fixture root. Fixtures are invented, in the shapes `agy` writes. Tests run in the unit lane (`test:unit`).
