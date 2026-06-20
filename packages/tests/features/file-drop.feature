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

  Scenario: a dropped video file is accepted and its path reaches the PTY
    # A .mov screen recording used to bounce off the extension allowlist with
    # a "File type not allowed" toast; video is now accepted like any other
    # drop and its saved path is bracketed-pasted into the PTY.
    When I drop a file named "screen-recording.mov" with content "fake video bytes" onto the terminal
    Then the screen state should contain "screen-recording.mov"
