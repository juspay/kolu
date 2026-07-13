@opencode-real @real-agent
Feature: OpenCode live-state detection against a real ollama model
  OpenCode's live agent-state pipeline (working → done), driven end-to-end by a
  REAL `opencode` CLI pointed at a locally-served ollama model through a
  throwaway $HOME — no fixture writes.

  hooks.ts seeds the throwaway home's ~/.config/opencode/opencode.json with an
  OpenAI-compatible provider whose baseURL is the local ollama /v1 endpoint, and
  makes that model the default. opencode writes its session to
  ~/.local/share/opencode/opencode-stable.db (the channel-suffixed name), which
  kolu's provider now resolves (the config.ts enumeration fix) — so the mock
  KOLU_OPENCODE_DB override is gone.

  Scope note (srid's ruling A→B fallback): this asserts the thinking→waiting
  arc, exactly like codex-real / claude-real, NOT tool_use. Reaching tool_use
  needs the model to emit a real tool call, which no ollama model the CPU CI box
  can run does deterministically — small models (0.5b, 1.5b) reply text without
  calling a tool, and 3b models (qwen2.5:3b, llama3.2:3b) time out (HTTP 500)
  mid-turn before the ~75s agentic turn completes. opencode's runningToolsBucket
  tool-part path is therefore a srid-owned coverage exemption (see the PR
  discussion), not silently dropped.

  Background:
    Given the terminal is ready

  Scenario: A real opencode turn flips the sensor working then done
    # OWN THE CLOCK the same way codex/claude do: the turn is real CPU inference
    # (multi-second on the tiny model), so the working window is naturally wide —
    # the prompt asks for a short enumerated list so the generation lasts several
    # seconds and "thinking" is comfortably observable, then ends cleanly.
    When I launch the real Opencode agent with prompt "Count from 1 to 20, one number per line. Then reply with only the word DONE."
    # Working: opencode is mid-turn (assistant message in flight, no finish yet),
    # which the provider maps to thinking and the dock buckets as working.
    Then the tile chrome should show a Opencode indicator with state "thinking" within 60 seconds
    And the dock should reflect the Opencode agent in the "working" bucket within 60 seconds
    # Done: the turn completed (assistant finished) — the sensor leaves "working".
    Then the tile chrome should show a Opencode indicator with state "waiting" within 60 seconds
    And the dock should reflect the Opencode agent as done within 60 seconds
    # Session DB landed at the REAL default path — under the throwaway home.
    And a real Opencode session file should exist at the default path
    And there should be no page errors
