@antigravity-mock
Feature: Antigravity CLI status detection
  When Google's Antigravity CLI (`agy`) is running in a terminal, the canvas
  tile chrome shows its current state (thinking, tool use, waiting).

  Requires KOLU_ANTIGRAVITY_DIR to point at a test-controlled directory and a
  fake `agy` binary (bash copy) that holds its conversation's presence lock
  open, as the real one does. Both are seeded by hooks.ts.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome lights up for an Antigravity conversation and follows a live state transition
    When an Antigravity conversation is mocked with state "thinking"
    Then the tile chrome should show an Antigravity indicator with state "thinking"
    When the Antigravity conversation state changes to "tool_use"
    Then the tile chrome should show an Antigravity indicator with state "tool_use"
    When the Antigravity conversation state changes to "waiting"
    Then the tile chrome should show an Antigravity indicator with state "waiting"
    And there should be no page errors

  # A fresh agy holds no conversation; its first prompt creates the lock it
  # then keeps open. That lands after the command-run reconcile ladder has run
  # empty, so detection rests on the presence-directory watch — a dead watch
  # leaves the tile dark. The first scenario cannot catch that.
  Scenario: Tile chrome lights up when the conversation starts after the reconcile ladder
    When an Antigravity process is running with no conversation yet
    And 1500 ms elapse past the command-run reconcile window
    And a conversation starts in the running Antigravity process with state "thinking"
    Then the tile chrome should show an Antigravity indicator with state "thinking"
    And there should be no page errors
