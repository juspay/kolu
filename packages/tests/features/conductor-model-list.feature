Feature: A host that cannot list its models
  kolu asks a work's host which models a harness offers, so the setup form
  can offer them. That list can fail — a gateway down, a key the environment
  lacks — and the person must still be able to choose. The form says what the
  host said, offers the models run before with that harness and a box to type
  one, and records a typed model AS TYPED: it goes to the harness as typed and
  is never held to a list. Starting the role never needs the list at all: how
  a launch takes a model is the host's `agent-distro --launch` word, which
  runs no harness.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: The person names the model the host could not list, and the implementor starts on it
    Given a repo for the work
    # A MODEL RUN BEFORE: the request names one for this work's implementor,
    # which is what the next form offers back.
    And I ask the conductor to open the work "list the models"
    And this machine cannot list its models
    When I ask the conductor to open the work "name the model" with its model left to me
    Then the work's model question should say the host could not list its models
    And the work's model question should offer "sonnet" from before, and a box
    When I answer the work's model question by typing "opus-by-hand" on the card
    Then the work's decisions should include "opus-by-hand"
    # The list still fails while the implementor starts: a typed model asks
    # for none, and the launch is `--launch`'s word.
    When I ask the conductor to run the implementor in the work's repo
    Then the conductor should say it ran "claude --model opus-by-hand"
    And there should be no page errors
