Feature: Foreground process detection
  The sidebar shows the OSC 2 terminal title by default (the shell's precmd
  hook sets this to the working directory), falling back to the process
  binary name when no title has been emitted. Detection is event-driven via
  title changes from the shell preexec hook.

  Background:
    Given the terminal is ready

  Scenario: Sidebar shows terminal title at startup
    # kolu's injected bash/zsh precmd hook sets OSC 2 to the current dir.
    # In bare-bash test envs this ends up being "~" (home abbreviation).
    # In richer shell configs (starship, oh-my-zsh) it can be "user@host: ~/dir".
    Then the sidebar process name should be non-empty
    And there should be no page errors
