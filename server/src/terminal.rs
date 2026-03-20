//! Terminal CRUD and status tracking.
//!
//! Plain functions operating on AppState. No manager objects.

use std::path::Path;
use std::time::{Duration, Instant};

use kolu_common::{Terminal, TerminalId, TerminalStatus};

use crate::pty::{self, PtyHandle};
use crate::state::AppState;

const IDLE_THRESHOLD: Duration = Duration::from_secs(5);
const STATUS_SWEEP_INTERVAL: Duration = Duration::from_secs(2);

/// A live terminal: metadata + PTY handle + child process.
pub struct LiveTerminal {
  pub info: Terminal,
  pub handle: PtyHandle,
  pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Create a new terminal. Rejects duplicate IDs.
pub fn create(
  state: &AppState,
  id: TerminalId,
  label: String,
  command: Vec<String>,
  cwd: &Path,
) -> anyhow::Result<Terminal> {
  if state.terminals().contains_key(&id) {
    anyhow::bail!("terminal ID '{}' already exists", id);
  }

  let cmd = command.first().map(|s| s.as_str()).unwrap_or("bash");
  let result = pty::spawn(
    cmd,
    cwd,
    kolu_common::DEFAULT_COLS,
    kolu_common::DEFAULT_ROWS,
  )?;

  let info = Terminal {
    id: id.clone(),
    label,
    command,
    status: TerminalStatus::Running,
  };

  let live = LiveTerminal {
    info: info.clone(),
    handle: result.handle,
    child: result.child,
  };

  state.terminals().insert(id, live);
  Ok(info)
}

/// List all terminals (metadata only).
pub fn list(state: &AppState) -> Vec<Terminal> {
  state
    .terminals()
    .iter()
    .map(|entry| entry.value().info.clone())
    .collect()
}

/// Get a single terminal's metadata.
pub fn get(state: &AppState, id: &str) -> Option<Terminal> {
  state
    .terminals()
    .get(id)
    .map(|entry| entry.value().info.clone())
}

/// Kill a terminal: sends SIGHUP, removes from registry.
pub fn kill(state: &AppState, id: &str) -> anyhow::Result<()> {
  let (_, mut live) = state
    .terminals()
    .remove(id)
    .ok_or_else(|| anyhow::anyhow!("terminal '{}' not found", id))?;
  let _ = live.child.kill();
  Ok(())
}

/// Background task that polls child processes and updates terminal status.
pub fn spawn_status_sweep(state: AppState) {
  tokio::spawn(async move {
    let mut interval = tokio::time::interval(STATUS_SWEEP_INTERVAL);
    loop {
      interval.tick().await;

      for mut entry in state.terminals().iter_mut() {
        let live = entry.value_mut();

        // Check if process exited
        match live.child.try_wait() {
          Ok(Some(exit_status)) => {
            live.info.status = TerminalStatus::Exited(exit_status.exit_code() as i32);
          }
          Ok(None) => {
            // Still running — check idle vs active
            let elapsed = live.handle.last_output_at.lock().unwrap().elapsed();
            live.info.status = if elapsed < IDLE_THRESHOLD {
              TerminalStatus::Running
            } else {
              TerminalStatus::Idle
            };
          }
          Err(_) => {
            // Can't poll — treat as exited
            live.info.status = TerminalStatus::Exited(-1);
          }
        }
      }
    }
  });
}
