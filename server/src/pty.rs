use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

const MAX_SCROLLBACK: usize = 100 * 1024; // 100KB

/// Commands sent to the PTY writer task via channel.
pub enum PtyCommand {
  /// Raw bytes to write to PTY stdin (keyboard input from browser).
  Write(Vec<u8>),
  /// Resize the PTY grid (browser viewport changed).
  Resize { cols: u16, rows: u16 },
}

/// Handle to a running PTY. Interact via `cmd_tx` (send commands)
/// and `subscribe()` (receive output). Drop to clean up.
pub struct PtyHandle {
  /// Send write/resize commands to the PTY writer task.
  pub cmd_tx: mpsc::Sender<PtyCommand>,
  /// Subscribe to PTY output. Each subscriber gets all bytes from the
  /// point of subscription onward. Use `scrollback()` for history.
  pub output_tx: tokio::sync::broadcast::Sender<bytes::Bytes>,
  /// Scrollback buffer — last 100KB of PTY output for replay on reconnect.
  scrollback: Arc<Mutex<VecDeque<u8>>>,
  /// Timestamp of last PTY output — used for Running vs Idle status.
  pub last_output_at: Arc<Mutex<Instant>>,
  _reader_task: JoinHandle<()>,
  _writer_task: JoinHandle<()>,
}

impl PtyHandle {
  /// Snapshot the scrollback buffer for replay on WebSocket connect.
  pub fn scrollback_snapshot(&self) -> Vec<u8> {
    let sb = self.scrollback.lock().unwrap();
    sb.iter().copied().collect()
  }
}

/// Result of spawning a PTY: the handle for I/O and the child for lifecycle.
pub struct SpawnResult {
  pub handle: PtyHandle,
  pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Spawn a new PTY running `cmd` in `cwd` with initial size `cols`x`rows`.
///
/// Returns a `SpawnResult` with the PtyHandle (for I/O) and the Child
/// (for kill/status polling).
pub fn spawn(cmd: &str, cwd: &Path, cols: u16, rows: u16) -> anyhow::Result<SpawnResult> {
  let pty_system = native_pty_system();
  let pty_size = PtySize {
    rows,
    cols,
    pixel_width: 0,
    pixel_height: 0,
  };

  let pair = pty_system.openpty(pty_size)?;

  let mut cmd_builder = CommandBuilder::new(cmd);
  cmd_builder.cwd(cwd);

  let child = pair.slave.spawn_command(cmd_builder)?;
  drop(pair.slave); // Only need master from here

  let writer = pair.master.take_writer()?;
  let reader = pair.master.try_clone_reader()?;

  let (cmd_tx, cmd_rx) = mpsc::channel::<PtyCommand>(256);
  let (output_tx, _) = tokio::sync::broadcast::channel::<bytes::Bytes>(256);
  let scrollback: Arc<Mutex<VecDeque<u8>>> = Arc::new(Mutex::new(VecDeque::new()));
  let last_output_at: Arc<Mutex<Instant>> = Arc::new(Mutex::new(Instant::now()));

  let writer_task = spawn_writer_task(writer, pair.master, cmd_rx);
  let reader_task = spawn_reader_task(
    reader,
    output_tx.clone(),
    scrollback.clone(),
    last_output_at.clone(),
  );

  Ok(SpawnResult {
    handle: PtyHandle {
      cmd_tx,
      output_tx,
      scrollback,
      last_output_at,
      _reader_task: reader_task,
      _writer_task: writer_task,
    },
    child,
  })
}

/// Background task that reads PTY output and broadcasts it.
/// Runs in `spawn_blocking` because portable_pty's reader is blocking I/O.
fn spawn_reader_task(
  reader: Box<dyn Read + Send>,
  output_tx: tokio::sync::broadcast::Sender<bytes::Bytes>,
  scrollback: Arc<Mutex<VecDeque<u8>>>,
  last_output_at: Arc<Mutex<Instant>>,
) -> JoinHandle<()> {
  tokio::task::spawn_blocking(move || {
    let mut reader = reader;
    let mut buf = [0u8; 4096];
    loop {
      match reader.read(&mut buf) {
        Ok(0) => break, // EOF — PTY closed
        Ok(n) => {
          let data = &buf[..n];

          // Append to scrollback, trim if over limit
          {
            let mut sb = scrollback.lock().unwrap();
            sb.extend(data);
            if sb.len() > MAX_SCROLLBACK {
              let excess = sb.len() - MAX_SCROLLBACK;
              sb.drain(..excess);
            }
          }

          // Update last output timestamp for status tracking
          *last_output_at.lock().unwrap() = Instant::now();

          // Broadcast to all connected WebSocket clients.
          // Ignore errors — means no subscribers right now.
          let _ = output_tx.send(bytes::Bytes::copy_from_slice(data));
        }
        Err(_) => break,
      }
    }
    tracing::info!("PTY reader task exited");
  })
}

/// Background task that writes to the PTY.
/// Owns the writer and master (for resize) — single owner, no mutexes.
fn spawn_writer_task(
  mut writer: Box<dyn Write + Send>,
  master: Box<dyn portable_pty::MasterPty + Send>,
  mut cmd_rx: mpsc::Receiver<PtyCommand>,
) -> JoinHandle<()> {
  tokio::task::spawn(async move {
    while let Some(cmd) = cmd_rx.recv().await {
      match cmd {
        PtyCommand::Write(data) => {
          // Write is blocking but typically fast (buffered pipe).
          let _ = writer.write_all(&data);
          let _ = writer.flush();
        }
        PtyCommand::Resize { cols, rows } => {
          let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
          };
          if let Err(e) = master.resize(size) {
            tracing::warn!("PTY resize failed: {}", e);
          }
        }
      }
    }
    tracing::info!("PTY writer task exited");
  })
}
