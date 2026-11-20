Feature: The Conductor compacts its own conversation
  Past about 200k tokens Claude Code replaces the older part of the
  Conductor's conversation with a summary by itself. Each compaction is one
  line in the chat, and kolu sends the rules again around it. The scripted
  agent reports the compactions and the context sizes these scenarios name.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: A compaction is one line, and it opens to the summary
    When I send the conductor the prompt "compact"
    Then the conductor transcript should show a "done" compaction line
    And the compaction line should read "compacted"
    And the compaction line should be folded
    When I open the compaction line
    Then the compaction line should say "Claude Code replaced the conversation above with this summary. The rules were sent again."
    And the compaction line should show the summary "Two works are open. Nothing waits on you."
    And there should be no page errors

  Scenario: A compaction that failed says why
    When I send the conductor the prompt "compact and fail"
    Then the conductor transcript should show a "failed" compaction line
    And the compaction line should read "could not compact"
    And the compaction line should say "Claude Code tried to compact this conversation and could not: the summary request was refused (overloaded)."
    And the conductor transcript should show a row of kind "agent" saying "carried on"
    And there should be no page errors

  Scenario: The status line says the conversation is compacting while it runs
    When I send the conductor the prompt "compact until steered"
    Then the conductor transcript should show a "running" compaction line
    And the conductor status should say it is "compacting the conversation"
    When I steer the conductor with "go on"
    Then the conductor transcript should show a "done" compaction line
    And the conductor transcript should show a row of kind "agent" saying "carried on"
    And there should be no page errors

  Scenario: The context meter's tip names where the conversation is compacted
    When I send the conductor the prompt "be 120000 tokens long"
    Then the conductor transcript should show a row of kind "agent" saying "now 120000"
    When I hover the conductor's context meter
    Then the context meter's tip should say "Claude Code compacts it at about 200k."

  Scenario: The message sent past the limit carries the rules, and only that one
    When I send the conductor the prompt "be 250000 tokens long"
    Then the conductor transcript should show a row of kind "agent" saying "now 250000"
    When I send the conductor the prompt "which kolu blocks"
    Then the conductor transcript should show a row of kind "agent" saying "carried: [kolu] How you work"
    When I send the conductor the prompt "which kolu blocks"
    Then the conductor transcript should show a row of kind "agent" saying "carried: nothing"
    And there should be no page errors
