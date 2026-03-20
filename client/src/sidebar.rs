//! Sidebar component listing terminals with status indicators.

use leptos::prelude::*;

use kolu_common::{Terminal, TerminalId, TerminalStatus};

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
    TerminalStatus::Idle => "text-yellow-400",
    TerminalStatus::Exited(_) => "text-red-400",
  }
}

/// Flat terminal list with status indicators and selection.
#[component]
pub fn Sidebar(
  terminals: ReadSignal<Vec<Terminal>>,
  active_id: ReadSignal<Option<TerminalId>>,
  #[prop(into)] on_select: Callback<TerminalId>,
  #[prop(into)] on_new: Callback<()>,
  #[prop(into)] on_kill: Callback<TerminalId>,
) -> impl IntoView {
  view! {
    <aside class="w-56 flex flex-col bg-slate-800 border-r border-slate-700">
      <div class="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <span class="text-xs font-semibold text-slate-400 uppercase tracking-wide">"Terminals"</span>
        <button
          class="text-xs text-blue-400 hover:text-blue-300"
          on:click=move |_| on_new.run(())
        >"+ new"</button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <For
          each=move || terminals.get()
          key=|t| t.id.clone()
          children=move |t: Terminal| {
            let id = t.id.clone();
            let id_select = id.clone();
            let id_kill = id.clone();
            let label = t.label.clone();
            let dot = status_dot(&t.status);
            let color = status_color(&t.status);
            let is_active = {
              let id = id.clone();
              move || active_id.get().as_deref() == Some(id.as_str())
            };

            view! {
              <div
                class=move || {
                  if is_active() {
                    "flex items-center gap-2 px-3 py-1.5 bg-slate-700 cursor-pointer"
                  } else {
                    "flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700/50 cursor-pointer"
                  }
                }
                on:click=move |_| on_select.run(id_select.clone())
              >
                <span class=color>{dot}</span>
                <span class="text-sm text-slate-300 truncate flex-1">{label}</span>
                <button
                  class="text-xs text-slate-500 hover:text-red-400 px-1"
                  title="Kill terminal"
                  on:click=move |e: web_sys::MouseEvent| {
                    e.stop_propagation();
                    on_kill.run(id_kill.clone());
                  }
                >"✕"</button>
              </div>
            }
          }
        />
      </div>
    </aside>
  }
}
