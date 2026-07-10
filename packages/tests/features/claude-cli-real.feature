@claude-cli-real @real-agent
Feature: Claude Code CLI-feature / user-action states against a real ollama model
  Stage-5 "(b)" real attempts (srid's classification ruling): unlike the
  model-emission-gated states (tool_use, workflow fan-out, AskUserQuestion — a
  dumb model can't emit them), these states are produced by a CLI FEATURE or a
  USER ACTION and are STABLE (they persist until the next action), so a real
  `claude` on a dumb ollama model can genuinely exercise kolu's detection of
  them. Each is one cheap real attempt; any that a real claude cannot make
  deterministically observable is exempted with ITS OWN failure evidence on the
  unit-test header (not folded into the model-emission exemption).

  Background:
    Given the terminal is ready

  Scenario: Interrupting a real claude turn with Escape reads as waiting
    # USER ACTION: Esc during a turn writes an interrupt marker to the transcript,
    # which deriveState reads as waiting (not stuck running).
    When I launch the real Claude agent with prompt "Count slowly from 1 to 200, one number per line."
    And I interrupt the running Claude turn with Escape
    Then the tile chrome should show a Claude indicator with state "waiting" within 60 seconds
    And there should be no page errors

  Scenario: A trailing /compact on a real claude session reads as waiting, not stuck
    # CLI FEATURE: /compact appends a summary + local-command bookkeeping; kolu
    # must skip those non-prompt entries and read the prior turn's waiting, not
    # pin the pill on thinking (the stuck-pill regression).
    When I launch the real Claude agent with prompt "Say the single word DONE and then stop."
    And the tile chrome should show a Claude indicator within 60 seconds
    And I run the Claude slash command "/compact"
    Then the tile chrome should show a Claude indicator with state "waiting" within 60 seconds
    And there should be no page errors

  # NOTE: /fork was ATTEMPTED here and exempted (srid's (b) ruling) — real
  # claude v2.1.76 `/fork` enters the fork INTERACTIVELY ("You are now in the
  # fork."), with no background sub-agent, so there is no running_background
  # state to observe (the sensor stays waiting). The mock's premise no longer
  # matches the CLI. The running_background/fork DERIVATION stays unit-tested;
  # see the exemption note in fork-detection.test.ts.

  Scenario: A real claude session resumed with --continue is detected
    # USER ACTION: exit + relaunch with --continue resumes the most recent
    # session for the cwd; kolu detects the resumed session (kind=claude-code)
    # from its on-disk transcript without confusing it for a stale sibling.
    # Detection-only: the session-file write after resume has a fast-box timing
    # race (darwin), and artifact-writing is already covered by claude-real —
    # what this proves is that the RESUMED session is detected.
    When I launch the real Claude agent with prompt "Say the single word DONE and then stop."
    And the tile chrome should show a Claude indicator within 60 seconds
    And I exit and resume the real Claude agent
    Then the tile chrome should show a Claude indicator within 60 seconds
    And there should be no page errors
