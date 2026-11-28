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

  # Opening a conversation that already exists (agy --conversation=<id>, as
  # wake runs it) creates nothing in presence/. agy then rewrites a file in
  # its top directory; the watch on that directory is what finds the lock
  # held. The fake opens the lock a second after the cache write, so on Linux
  # the cache's wake comes and goes too early, and after the retries have run.
  Scenario: Tile chrome follows an existing conversation opened after the reconcile ladder
    When an Antigravity process is running that will open an existing conversation with state "waiting"
    And 1500 ms elapse past the command-run reconcile window
    And the running Antigravity process opens the existing conversation
    Then the tile chrome should show an Antigravity indicator with state "waiting"
    And there should be no page errors

  # The /resume picker switches a running agy to another existing
  # conversation: no command starts, nothing is created in presence/. The tile
  # must move to the second conversation, whose state differs from the first.
  Scenario: Tile chrome moves when a running Antigravity process switches conversations
    When an Antigravity process holds a conversation with state "waiting" and another exists with state "tool_use"
    Then the tile chrome should show an Antigravity indicator with state "waiting"
    When the running Antigravity process switches to the other conversation
    Then the tile chrome should show an Antigravity indicator with state "tool_use"
    And there should be no page errors
