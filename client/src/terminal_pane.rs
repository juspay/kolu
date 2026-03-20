//! Container component that manages terminal view lifecycle.
//!
//! Keeps all created TerminalViews mounted in the DOM but hides inactive ones
//! via CSS `display: none`. This avoids Leptos component destroy/recreate issues
//! where old WebSocket connections weren't properly cleaned up, causing garbled
//! output when switching terminals.

use leptos::prelude::*;

use kolu_common::TerminalId;

use crate::terminal_view::TerminalView;

/// Renders all terminals, showing only the active one.
/// Each terminal stays mounted for its entire lifetime — no destroy/recreate cycle.
#[component]
pub fn TerminalPane(
  active_id: ReadSignal<Option<TerminalId>>,
  terminals: ReadSignal<Vec<kolu_common::Terminal>>,
) -> impl IntoView {
  view! {
    <For
      each=move || terminals.get()
      key=|t| t.id.clone()
      let:terminal
    >
      {
        let tid = terminal.id.clone();
        let tid2 = tid.clone();
        view! {
          <div
            class="w-full h-full border border-slate-600 rounded overflow-hidden"
            style:display=move || {
              if active_id.get().as_deref() == Some(tid.as_str()) {
                ""
              } else {
                "none"
              }
            }
          >
            <TerminalView terminal_id=tid2 />
          </div>
        }
      }
    </For>
    {move || {
      if active_id.get().is_none() {
        Some(view! {
          <div class="flex items-center justify-center h-full text-slate-500">
            "No terminal selected. Click '+ new' to create one."
          </div>
        })
      } else {
        None
      }
    }}
  }
}
