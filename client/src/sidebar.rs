//! Sidebar component: flat terminal list with status indicators.

use leptos::prelude::*;

use kolu_common::{Terminal, TerminalId, TerminalStatus};

/// Status indicator dot for a terminal.
fn status_dot(status: &TerminalStatus) -> &'static str {
  match status {
    TerminalStatus::Running => "●",
    TerminalStatus::Idle => "○",
    TerminalStatus::Exited(_) => "✕",
  }
}

fn status_color(status: &TerminalStatus) -> &'static str {
  match status {
    TerminalStatus::Running => "text-green-400",
    TerminalStatus::Idle => "text-slate-400",
    TerminalStatus::Exited(_) => "text-red-400",
  }
}

/// Sidebar listing all terminals with status dots.
#[component]
pub fn Sidebar(
  terminals: ReadSignal<Vec<Terminal>>,
  active_id: ReadSignal<Option<TerminalId>>,
  #[prop(into)] set_active_id: Callback<Option<TerminalId>>,
  #[prop(into)] on_new: Callback<()>,
  #[prop(into)] on_delete: Callback<TerminalId>,
) -> impl IntoView {
  view! {
      <aside class="flex flex-col w-64 bg-slate-800 border-r border-slate-700 overflow-y-auto">
          <div class="flex items-center justify-between px-3 py-2 border-b border-slate-700">
              <span class="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  "Terminals"
              </span>
              <button
                  class="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                  on:click=move |_| on_new.run(())
              >
                  "+ New"
              </button>
          </div>
          <ul class="flex-1 py-1">
              <For
                  each=move || terminals.get()
                  key=|t| t.id.clone()
                  let:terminal
              >
                  {
                      let id = terminal.id.clone();
                      let id_click = id.clone();
                      let id_delete = id.clone();
                      let label = terminal.label.clone();
                      let status = terminal.status.clone();
                      view! {
                          <li
                              class=move || {
                                  let base = "flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm";
                                  let active = active_id.get().as_deref() == Some(id.as_str());
                                  if active {
                                      format!("{} bg-slate-700 text-white", base)
                                  } else {
                                      format!("{} text-slate-300 hover:bg-slate-700/50", base)
                                  }
                              }
                              on:click=move |_| set_active_id.run(Some(id_click.clone()))
                          >
                              <span class=status_color(&status)>{status_dot(&status)}</span>
                              <span class="flex-1 truncate">{label}</span>
                              <button
                                  class="text-slate-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100"
                                  on:click=move |e: web_sys::MouseEvent| {
                                      e.stop_propagation();
                                      on_delete.run(id_delete.clone());
                                  }
                              >
                                  "×"
                              </button>
                          </li>
                      }
                  }
              </For>
          </ul>
      </aside>
  }
}
