@claude-real @real-agent
Feature: Claude Code live-state detection against a real ollama model
  Claude Code's live agent-state pipeline (working → done), driven end-to-end by
  a REAL `claude` CLI pointed at a locally-served ollama model through a
  throwaway $HOME — no fixture writes. ollama serves the Anthropic Messages API
  at /v1/messages, which is exactly what Claude Code speaks (srid's Stage C).

  hooks.ts seeds the throwaway home's ~/.claude/settings.json (ANTHROPIC_BASE_URL
  → ollama) and ~/.claude.json (clears the first-run onboarding / theme /
  folder-trust gates), so claude boots straight to its prompt; it writes
  sessions/<pid>.json + a projects/<cwd>/*.jsonl transcript at the real default
  path, which kolu's claude provider reads. Claude Code is a Node CLI, so no
  darwin code-signing / version pin is needed (unlike codex).

  Background:
    Given the terminal is ready

  Scenario: A real claude turn flips the sensor working then done
    When I launch the real Claude agent with prompt "Say the single word DONE and then stop."
    # Working: claude is mid-turn.
    Then the tile chrome should show a Claude indicator with state "thinking" within 60 seconds
    And the dock should reflect the Claude agent in the "working" bucket within 60 seconds
    # Done: the turn completed — the sensor leaves "working".
    Then the tile chrome should show a Claude indicator with state "waiting" within 60 seconds
    And the dock should reflect the Claude agent as done within 60 seconds
    # Session files landed at the REAL default path — under the throwaway home.
    And a real Claude session file should exist at the default path
    And there should be no page errors
