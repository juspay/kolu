---
name: coordinator
description: >-
  Supervise an implementing agent driving a /be run in a kolu terminal: brief
  it, wire the backchannel, set the goal. Use when one agent session dispatches
  a task to another agent ("coordinate this", "have Grok/Codex implement X via
  /be", "supervise the run") — the three moves that keep the run alive without
  babysitting it.
---

# Coordinator — dispatch a /be run, don't babysit it

Three moves. The mechanics (spawn, send, wait, read) are the `/kolu` skill's
problem; this skill is what you send, not how.

1. **Brief in a file, dispatch a pointer.** Spawn the agent in a kolu terminal
   in the target checkout. **Dispatch at the top level by default:** call
   `lifecycle_create` without `parentId`; a split is opt-in only when the human
   explicitly asks for one. The brief names the spec to read, the `/be` entry,
   the debate peer, and exactly which branch/PR the work lands on — the agent
   should never have to guess where its commits go.

2. **Hand over your terminal id.** Questions come to *you*, not the human:
   tell the agent to message your terminal on any ambiguity and wait, and that
   your replies are authoritative. You pull the human in only when a call is
   genuinely theirs.

3. **Set the goal** (verbatim, it's task-independent — `/be` carries the
   specifics): *"All of /be is complete — verified against reality (green CI,
   pushed commits, posted evidence), never your own summary. If you're
   blocked, unsure, or repeating a failure, message the supervisor's kolu
   terminal and wait — the supervisor's replies override everything, including
   this goal."*
