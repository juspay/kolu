Feature: Drag-and-drop file upload
  When the user drops a file onto a terminal, the server saves the
  file under the terminal's clipboard directory and bracketed-pastes
  the path into the PTY. Agents that accept paste-as-file-path
  (codex, Claude Code) can then read the file.

  Background:
    Given the terminal is ready

  Scenario: dropped file path is delivered to the PTY
    When I drop a file named "notes.md" with content "hello drop" onto the terminal
    Then the screen state should contain "notes.md"
