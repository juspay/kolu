Feature: A reply stays with the message it answers
  A message sent while the Conductor is still writing its reply waits at the
  bottom of the chat, marked queued, and the reply goes on above it in the
  same paragraph. When the message's own turn comes, its reply is drawn under
  it. The scripted agent's `talk across turns` turn says the first half of an
  answer, says the second half only once the next message has arrived, and
  ends only when it is stopped: what the scenario does is what moves it.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: A message sent mid-reply waits below the whole reply, then gets its own
    When I send the conductor the prompt "talk across turns"
    Then the conductor transcript should show a row of kind "agent" saying "The first half of the answer"
    When I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "written after your next message"
    And the conductor transcript's last row should be my message "say hello", marked "queued"
    And the conductor's reply should be one row saying "The first half of the answer, and the second half", above my message "say hello"
    When I stop the conductor's turn
    Then the conductor transcript should mark no user row "queued"
    And the row after my message "say hello" should be the conductor saying "hello back"
    And there should be no page errors
