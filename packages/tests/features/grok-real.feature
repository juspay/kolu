@grok-real @real-agent
Feature: Grok Build live-state detection against a real ollama model
  Grok Build's live agent-state pipeline (working → done), driven end-to-end by
  the genuine xAI `grok` CLI pointed at a locally-served ollama model through a
  throwaway $HOME — no fixture writes. This is the unconditional replacement for
  the mock grok scenarios (srid's ruling): grok goes real via the authentic
  Build CLI, both platforms.

  hooks.ts seeds the throwaway home's ~/.grok/config.toml with a custom model
  whose base_url is the local ollama /v1 endpoint and api_backend =
  "chat_completions", plus a dummy XAI_API_KEY — so grok boots "Logged in with
  API key", no xAI login/welcome gate, straight to its prompt. grok writes
  active_sessions.json + sessions/<cwd>/<uuid>/events.jsonl under ~/.grok, which
  kolu's grok provider reads via KOLU_GROK_DIR.

  Scope note (mirrors opencode, srid's ruling A→B fallback): this asserts the
  thinking→waiting arc, NOT tool_use / awaiting_user. Those states need the model
  to emit a real tool call (or an ask-user tool), which no ollama model the CPU
  CI box can run does deterministically — see the exemption on opencode's
  runningToolsBucket. grok's phase→state fold (tool_execution → tool_use,
  permission_prompt → awaiting_user) is covered by pure-function unit tests
  (foldEventsState), fed synthetic events, in the grok integration package.

  Background:
    Given the terminal is ready

  # Scope note (srid's ruling B-MINIMAL → fallback): asserts DETECTION + real
  # session artifacts, NOT the transient thinking→waiting arc. grok's turn_ended
  # phase appends to events.jsonl AFTER the watcher attaches, and a coalesced /
  # missed fs.watch re-read (macOS kqueue especially) can strand "thinking" — the
  # append-poll half of juspay/kolu#1754. Restore the thinking→waiting +
  # working-bucket asserts when #1754 lands. The phase→state fold stays
  # unit-tested (foldEventsState).
  Scenario: A real grok CLI is detected and writes its session artifacts
    When I launch the real Grok agent with prompt "Count from 1 to 20, one number per line. Then reply with only the word DONE."
    # Detection: the tile indicator carries kind=grok. No transient-state assert.
    Then the tile chrome should show a Grok indicator within 60 seconds
    # Session files landed at the REAL default path — under the throwaway home.
    And a real Grok session file should exist at the default path
    And there should be no page errors
