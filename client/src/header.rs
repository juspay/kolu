//! App header with branding and connection status.

use leptos::prelude::*;

use crate::ws::WsStatus;

/// Top bar showing the app logo, name, and live WebSocket status.
#[component]
pub fn Header(ws_status: ReadSignal<WsStatus>) -> impl IntoView {
  view! {
      <header class="flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700">
          <img src="/favicon.svg" alt="kolu" class="w-6 h-6" />
          <span class="text-sm font-semibold text-slate-300">{kolu_common::hello()}</span>
          <span class={move || format!("ml-auto text-xs {}", ws_status.get().css_color())}>
              {move || ws_status.get().label()}
          </span>
      </header>
  }
}
