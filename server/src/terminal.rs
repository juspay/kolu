use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use kolu_common::*;

use crate::pty;
use crate::state::{AppState, LiveTerminal};

const IDLE_THRESHOLD: Duration = Duration::from_secs(5);

/// Create a new terminal with auto-generated ID.
pub fn create(state: &AppState, req: CreateTerminalRequest) -> Result<Terminal, StatusCode> {
  let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
  let command = req.command.to_argv(&shell);
  let label = req.command.label().to_string();

  let cwd = req
    .cwd
    .map(std::path::PathBuf::from)
    .unwrap_or_else(|| {
      std::env::var("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap())
    });

  // Auto-generate unique ID: command-label + counter
  let count = state.terminals().len();
  let id = format!("{}-{}", label, count);

  let pty_handle = pty::spawn(&id, &command, &cwd, DEFAULT_COLS, DEFAULT_ROWS)
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

  let info = Terminal {
    id: id.clone(),
    label,
    command,
    status: TerminalStatus::Running,
  };

  state.terminals().insert(
    id,
    LiveTerminal {
      info: info.clone(),
      pty: pty_handle,
    },
  );

  Ok(info)
}

/// List all terminals with current status.
pub fn list(state: &AppState) -> Vec<Terminal> {
  state
    .terminals()
    .iter()
    .map(|entry| entry.info.clone())
    .collect()
}

/// Kill and remove a terminal. Returns 404 if not found.
pub fn kill(state: &AppState, id: &str) -> Result<(), StatusCode> {
  let (_, live) = state.terminals().remove(id).ok_or(StatusCode::NOT_FOUND)?;
  live.pty.kill();
  Ok(())
}

/// Update terminal statuses based on child process state and output activity.
/// Run as a periodic tokio task.
pub fn sweep_status(state: &AppState) {
  let now_millis = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap()
    .as_millis() as u64;

  for mut entry in state.terminals().iter_mut() {
    let live = entry.value_mut();
    if let Some(exit_code) = live.pty.try_wait() {
      live.info.status = TerminalStatus::Exited(exit_code as i32);
    } else {
      let last = live.pty.last_output_at.load(Ordering::Relaxed);
      let elapsed = Duration::from_millis(now_millis.saturating_sub(last));
      if elapsed > IDLE_THRESHOLD {
        live.info.status = TerminalStatus::Idle;
      } else {
        live.info.status = TerminalStatus::Running;
      }
    }
  }
}
