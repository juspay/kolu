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
