//! WebSocket handler that bridges browser clients to the PTY.
//!
//! This module routes messages between WebSocket transport and PTY I/O.
//! The PTY lifecycle lives in `pty.rs`; WS framing is handled by axum.

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use futures::stream::StreamExt;
use futures::SinkExt;
use tokio::sync::{broadcast, mpsc};

use kolu_common::WsClientMessage;

use crate::pty::PtyCommand;
use crate::state::AppState;

/// Axum handler: upgrade HTTP to WebSocket for terminal I/O.
/// Route: `GET /ws/:terminal_id`
pub async fn ws_handler(
  ws: WebSocketUpgrade,
  Path(terminal_id): Path<String>,
  State(state): State<AppState>,
) -> Response {
  let entry = match state.terminals().get(&terminal_id) {
    Some(entry) => entry,
    None => return StatusCode::NOT_FOUND.into_response(),
  };

  let cmd_tx = entry.pty.cmd_tx.clone();
  let output_tx = entry.pty.output_tx.clone();
  let scrollback = entry.pty.scrollback_snapshot();
  drop(entry); // Release DashMap ref before upgrade

  ws.on_upgrade(move |socket| handle_socket(socket, terminal_id, cmd_tx, output_tx, scrollback))
    .into_response()
}

/// Bidirectional pipe between a WebSocket client and the PTY.
///
/// On connect: replays scrollback so the client sees prior output.
/// Then: PTY output → WS binary frames, WS input → PTY stdin.
async fn handle_socket(
  socket: WebSocket,
  terminal_id: String,
  cmd_tx: mpsc::Sender<PtyCommand>,
  output_tx: broadcast::Sender<bytes::Bytes>,
  scrollback: Vec<u8>,
) {
  let (mut ws_tx, mut ws_rx) = socket.split();

  // Replay scrollback so reconnecting clients see history
  if !scrollback.is_empty()
    && ws_tx
      .send(Message::Binary(scrollback.into()))
      .await
      .is_err()
  {
    return;
  }

  // Subscribe to PTY output broadcast AFTER scrollback replay.
  let mut output_rx = output_tx.subscribe();

  // PTY output → WebSocket (binary frames)
  let send_task = tokio::spawn(async move {
    while let Ok(data) = output_rx.recv().await {
      if ws_tx
        .send(Message::Binary(data.to_vec().into()))
        .await
        .is_err()
      {
        break;
      }
    }
  });

  // WebSocket → PTY stdin
  let recv_task = tokio::spawn(async move {
    while let Some(Ok(msg)) = ws_rx.next().await {
      match msg {
        // Binary frames: raw terminal input (keystrokes)
        Message::Binary(data) => {
          let _ = cmd_tx.send(PtyCommand::Write(data.to_vec())).await;
        }
        // Text frames: JSON control messages (e.g. Resize)
        Message::Text(text) => {
          if let Ok(client_msg) = serde_json::from_str::<WsClientMessage>(&text) {
            match client_msg {
              WsClientMessage::Resize { cols, rows } => {
                let _ = cmd_tx.send(PtyCommand::Resize { cols, rows }).await;
              }
            }
          } else {
            // Treat unrecognized text as raw input
            let _ = cmd_tx
              .send(PtyCommand::Write(text.as_bytes().to_vec()))
              .await;
          }
        }
        Message::Close(_) => break,
        _ => {}
      }
    }
  });

  // Wait for either direction to finish, then clean up
  tokio::select! {
      _ = send_task => {},
      _ = recv_task => {},
  }

  tracing::debug!(terminal_id = %terminal_id, "WebSocket connection closed");
}
