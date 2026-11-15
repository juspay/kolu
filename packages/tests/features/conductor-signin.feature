Feature: Signing the Conductor in again
  The agent offers a sign-in only when it refuses something for want of one.
  An account at its weekly limit, the wrong account and a login that went
  stale are all signed in, so the menu always has the door: `Sign in again…`
  while signed in. A sign-in that takes restarts the agent into the same
  conversation, because a running adapter keeps the credential it started
  with. The scripted agent reports its account on every start and its login
  moves that account on, so the scenarios compare before and after.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: Signing in again from the menu, and the next turn runs as the new account
    When I note the conductor's account
    And I ask to sign in again from the conductor menu
    Then the sign-in row I asked for should offer "Claude account"
    When I sign in with "Claude account"
    Then the conductor's account should have moved on
    And there should be no sign-in row
    When I send the conductor the prompt "who am I"
    Then the conductor should answer as the account it shows
    And there should be no page errors

  Scenario: A message the account cannot run points at the door, and closing it changes nothing
    When I note the conductor's account
    And I send the conductor the prompt "hit the limit"
    Then the conductor transcript should mark a user row "refused"
    And the refused message should offer to sign in again
    When I press sign in again beside the refused message
    Then the sign-in row I asked for should offer "Claude account"
    When I close the sign-in row
    Then there should be no sign-in row
    And the conductor's account should be the one I noted
    And there should be no page errors
