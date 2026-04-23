Feature: Clipboard image paste
  When the user pastes an image into a terminal, the server saves the
  image to disk and bracketed-pastes the path into the PTY. Agents that
  accept paste-as-file-path (codex, Claude Code) auto-attach the image.

  Background:
    Given the terminal is ready

  Scenario: pasted image path is delivered to the PTY
    When I paste an image into the terminal
    Then the screen state should contain "image.png"
