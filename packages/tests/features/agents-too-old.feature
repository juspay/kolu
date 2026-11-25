Feature: Agents older than the kolu talking to them
  A host serves the agent-distro package kolu DELIVERED — upstream's newest
  published one — not the floor the kolu talking to it was built with. So a
  machine that has not been updated serves a picker that cannot be asked which
  models a harness offers, and that skew is permanent in kind: there is always
  a kolu newer than some host's agents. kolu reads it off the package itself
  (`share/agent-distro/answers`, which a package older than `--models` has not
  got), never off the picker's error, and names it: the work is refused before
  any setup form exists, so nobody is handed a question they cannot answer.

  The floor under this suite is aged out — its `answers` taken away — BEFORE
  Agents is turned on, because settling the status padi publishes is when the
  package it serves is read.

  Scenario: A work whose setup names a harness is refused on agents too old to ask
    Given the terminal is ready
    And this machine's agents are older than this kolu needs
    And the conductor is on a fresh conversation
    Then padi should say this machine's agents cannot be asked for models
    When I send the conductor an open for the work "rewrite the parser"
    Then the conductor transcript should show a row of kind "agent" saying "nothing opened"
    And the conductor should say this machine's agents are older than this kolu needs
    And no setup question should be put to me
    And the conductor status should say nothing is in progress
    And there should be no page errors
