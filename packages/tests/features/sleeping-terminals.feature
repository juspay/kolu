Feature: Sleeping terminals
  A terminal can be put to sleep — its PTY, renderer, and agent released — and
  woken later. The sleeping tile stays a first-class tile through the SAME paths
  as a live one: it renders on the canvas, keeps its place, and persists across a
  reload, rehydrated as sleeping (never auto-woken).

  Background:
    Given the terminal is ready

  Scenario: Sleep a terminal, then wake it in place
    Then there should be 1 live tile
    And there should be 0 sleeping tiles
    When I sleep the active terminal
    Then there should be 1 sleeping tile
    And there should be 0 live tiles
    When I wake the sleeping terminal
    Then there should be 0 sleeping tiles
    And there should be 1 live tile
    And there should be no page errors

  Scenario: A slept terminal survives a reload, still asleep
    When I sleep the active terminal
    Then there should be 1 sleeping tile
    When I reload the page
    Then there should be 1 sleeping tile
    And there should be 0 live tiles
    And there should be no page errors

  Scenario: A woken terminal is live and usable
    When I run "echo SLEEP_ALPHA"
    Then the active terminal should show "SLEEP_ALPHA"
    When I sleep the active terminal
    And I wake the sleeping terminal
    Then there should be 1 live tile
    And there should be 0 sleeping tiles
    When I run "echo WOKE_BRAVO"
    Then the active terminal should show "WOKE_BRAVO"
    And there should be no page errors

  Scenario: A sleeping tile appears as a dock row
    When I sleep the active terminal
    Then there should be 1 sleeping tile
    And there should be 1 sleeping dock row
    And there should be no page errors

  Scenario: Discarding a sleeping tile removes it for good
    When I sleep the active terminal
    Then there should be 1 sleeping tile
    When I discard the sleeping terminal
    Then there should be 0 sleeping tiles
    And there should be 0 live tiles

  Scenario: Sleeping one of two terminals leaves the other live and usable
    When I create a terminal
    Then there should be 2 live tiles
    When I sleep the active terminal
    Then there should be 1 sleeping tile
    And there should be 1 live tile
    When I run "echo STILL_ALIVE"
    Then the active terminal should show "STILL_ALIVE"
    And there should be no page errors

  # Regression: a single corrupt/legacy sleeping record (root id matches no
  # terminal) used to fail the whole cell's validation, so the client saw an
  # empty cell and EVERY sleep silently lost its terminal. The runtime filter
  # must drop the orphan and keep the feature working.
  Scenario: A corrupt sleeping record does not break sleeping
    Given a corrupt sleeping record already exists
    When I sleep the active terminal
    Then there should be 1 sleeping tile
    And there should be no page errors
