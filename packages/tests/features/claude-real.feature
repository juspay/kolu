@claude-real @real-agent
Feature: Claude Code detection against a real ollama model
  Claude Code driven end-to-end by a REAL `claude` CLI pointed at a
  locally-served ollama model through a throwaway $HOME — no fixture writes.
  ollama serves the Anthropic Messages API at /v1/messages, which is exactly
  what Claude Code speaks (srid's Stage C).

  hooks.ts seeds the throwaway home's ~/.claude/settings.json (ANTHROPIC_BASE_URL
  → ollama) and ~/.claude.json (clears the first-run onboarding / theme /
  folder-trust gates), so claude boots straight to its prompt; it writes
  sessions/<pid>.json + a projects/<cwd>/*.jsonl transcript at the real default
  path, which kolu's claude provider reads. Claude Code is a Node CLI, so no
  darwin code-signing / version pin is needed (unlike codex).

  What this covers, and what it does NOT (srid's ruling B-prime):
    COVERS — that kolu DETECTS the real `claude` CLI as the claude-code agent
    (the indicator carries kind=claude-code) and that claude writes its real
    session artifacts at the default paths. That detection fact is the
    integration this campaign exists to prove.
    Does NOT cover — the live STATE machine (thinking → waiting). Unlike
    codex/grok/opencode, claude's state is NOT deterministically observable on a
    fast (sub-3s) ollama turn, in BOTH directions: (a) claude writes its
    transcript JSONL at turn END, so mid-turn "thinking" rides only the
    screen-scrape poll, which a short turn can evade; (b) worse, kolu can stick
    on "thinking" AFTER the turn completes — the transcript's assistant entry
    carries a stop_reason that isn't "end_turn" (ollama's Messages emulation),
    which deriveState reads as thinking, and the trailing-transient decay to
    waiting is probe/timing-dependent. Both are tracked as a provider robustness
    BUG: juspay/kolu#1754. The state derivation itself is unit-tested —
    index.test.ts (deriveState: end_turn → waiting, and the thinking/tool_use/
    awaiting cases), transient-decay.test.ts (a trailing transient decays to
    waiting), fork-detection.test.ts (fork/workflow states), and screen.test.ts
    (the screen-scrape awaiting-user promotion).

  Background:
    Given the terminal is ready

  Scenario: A real claude CLI is detected and writes its session artifacts
    When I launch the real Claude agent with prompt "Say the single word DONE and then stop."
    # Detection: the tile indicator carries kind=claude-code — kolu recognized
    # the real claude CLI as the agent. No state assertion (see the scope note).
    Then the tile chrome should show a Claude indicator within 60 seconds
    # Artifacts: claude wrote its real session files at the default path under
    # the throwaway home (sessions/<pid>.json + a projects/<cwd>/*.jsonl).
    And a real Claude session file should exist at the default path
    And there should be no page errors
