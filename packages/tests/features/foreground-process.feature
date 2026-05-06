Feature: Foreground process detection
  The workspace switcher shows the OSC 2 terminal title. Our injected shell hooks
  set the title to the CWD at every prompt (precmd) and to the running
  command while it executes (preexec). Detection is event-driven via
  title changes.

  Background:
    Given the terminal is ready

  Scenario: Workspace switcher shows terminal title at startup
    # kolu's injected bash/zsh precmd hook sets OSC 2 to the current dir.
    # In bare-bash test envs this ends up being "~" (home abbreviation).
    # In richer shell configs (starship, oh-my-zsh) it can be "user@host: ~/dir".
    Then the workspace switcher process name should be non-empty
    And there should be no page errors

  Scenario: Workspace switcher title updates to the running command
    # Run a long-running command — our preexec hook should emit OSC 2
    # with the command string, causing the workspace switcher title to update.
    When I run a long-running "sleep 5" command
    Then the workspace switcher process name should contain "sleep"
    And there should be no page errors
