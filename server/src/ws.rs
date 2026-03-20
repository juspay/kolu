//! WebSocket handler that bridges browser clients to a PTY.
//!
//! Routes messages between WebSocket transport and the PTY identified
//! by the terminal_id path parameter. The PTY lifecycle lives in
//! `pty.rs`; terminal registry in `terminal.rs`.

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use futures::stream::StreamExt;
use futures::SinkExt;

use kolu_common::WsClientMessage;

use crate::pty::PtyCommand;
use crate::state::AppState;

/// Axum handler: upgrade HTTP to WebSocket for terminal I/O.
/// Route: `GET /ws/:terminal_id`
pub async fn ws_handler(
  ws: WebSocketUpgrade,
  Path(terminal_id): Path<String>,
  State(state): State<AppState>,
) -> axum::response::Response {
  // Verify terminal exists before upgrading
  let Some(entry) = state.terminals().get(&terminal_id) else {
    return (StatusCode::NOT_FOUND, "terminal not found").into_response();
  };

  let scrollback = entry.value().handle.scrollback_snapshot();
  let output_tx = entry.value().handle.output_tx.clone();
  let cmd_tx = entry.value().handle.cmd_tx.clone();
  drop(entry); // Release DashMap ref before upgrade

  ws.on_upgrade(move |socket| handle_socket(socket, scrollback, output_tx, cmd_tx))
    .into_response()
}

/// Bidirectional pipe between a WebSocket client and a PTY.
///
/// On connect: replays scrollback so the client sees prior output.
/// Then: PTY output → WS binary frames, WS input → PTY stdin.
async fn handle_socket(
  socket: WebSocket,
  scrollback: Vec<u8>,
  output_tx: tokio::sync::broadcast::Sender<bytes::Bytes>,
  cmd_tx: tokio::sync::mpsc::Sender<PtyCommand>,
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

  tracing::debug!("WebSocket connection closed");
}
