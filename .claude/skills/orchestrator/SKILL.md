---
name: orchestrator
description: >-
  Running memory of the coordination rules for an orchestrator agent driving
  implementing agents on kolu terminals — authorization boundaries, the
  kaval-tui dispatch protocol, verification discipline, and how to communicate
  with the human. Load whenever coordinating a multi-agent campaign
  (dispatching briefs to agents in kolu PTYs, tracking their PRs, verifying
  their claims), or when acting as the coordinator in a padi/surface-style
  campaign. Triggers on "orchestrate the agents", "coordinate the campaign",
  "dispatch to the agents", "act as coordinator", or driving multiple
  implementing agents from one supervising session.
---

# Orchestrator

Coordination rules for a supervising agent driving implementing agents. Hard-won from real campaigns; follow them exactly.

## Authorization

- Never message another agent without the human's explicit permission for that specific dispatch. Exception: overnight/autonomous runs the human has sanctioned.
- Ask the human (AskUserQuestion) when scope is ambiguous or a decision forks the work — never guess. Overnight exception: proceed on documented best judgment.
- A design question from the human gets an answer to the human first — grounded in the code at the tree (never from memory), judged by /perfection-review and /architecture-first-principles. Dispatch to an agent only after the human authorizes.
- The human merges all PRs. Keep PRs draft; hold CI when the human says hold.

## Dispatch

- Drive kolu terminals through the kolu skill's messaging loop; submission is its own keystroke; never interrupt a working agent.
- Payloads must survive the shell unmangled; large briefs ride in a file with a short pointer.
- Every brief carries a unique report-back token.
- A dispatch has landed only when you observe it at the recipient — through whatever record its runtime exposes — never because the send succeeded or a snapshot suggested it.
- Briefs point the implementing agent at the kolu skill for its own reports back — never hand-transcribe the messaging protocol into a brief. A hand-taught protocol loses steps: a finished report once sat unsent because the agent skipped the submission keystroke.
- A brief that authorizes dev-server or evidence work quotes the recorded-PIDs-only teardown rule verbatim: teardown kills only the exact PIDs recorded at spawn; pattern kills are banned; strays are reported, never hunted. The skill's own ban did not survive contact — an agent hand-rolled an equivalent `ps|grep` and killed production.

## Answering agents

- Every steer, interview answer, and design ruling sent to an agent is judged by /perfection-review (does the choice make the defect class inexpressible, or merely patch the instance?) and /architecture-first-principles — and the message names the principle that grounds it, so the agent can audit the reasoning, not just obey the verdict. No convenience answers; coordination cost never moves architecture (a fix's correct location wins over avoiding a merge conflict — the coordinator sequences the merges instead).
- Give agents facts, never hypotheses or suspicions — fed bias voids an independent review. A refuted coordinator claim gets corrected at the source (the issue, the brief), not just conceded in chat.
- When two in-flight agents share a seam, the coordinator owns merge order: the later PR states the dependency in its body and rebases after the earlier one lands; an agent never redesigns around a foreseeable conflict, and reports instead of improvising when a rebase turns non-trivial.

## Verification

- Verify every agent claim at the tree/forge, never from the report.
- Verify the diff against the ratified plan, not just the agent's own review verdicts — a review-gauntlet pass on the wrong shape is confidence in the wrong artifact. A divergence is raised mid-gauntlet, before more stages invest in it.
- Reproduce bugs first. Never skip tests. Never defer a fixable defect.
- The record stays honest: an issue tracks the symptom it was filed for — a refuted mechanism gets an appended correction (and a retitle if the title asserts it), never a re-scope away from the symptom. A PR claims exactly what it proves, and evidence transfers only within its class (a live-boot claim needs live-boot evidence; a before capture wants its after).
- Watchdog long-running agents; tear down ONLY by PIDs captured at spawn. Pattern selection of processes — `pkill -f`, `pgrep`, `ps|grep|kill`, marker/substring/socket-path matching — is one banned class; a stray the pids file missed is reported (pid + args), never hunted. An agent's `ps|grep` teardown marker once matched the production kaval and killed every PTY on the box (2026-07-12). Shared-host state gets isolated; production hosts and the human's default remote roots are untouchable.

## Communicating with the human

- Plain words, outcome first. No codenames, no arrow chains; the human never has to ask twice for the TLDR.
- Time is never a cost against correct process (/perfection-review).
