mod bridge;
mod header;
mod new_session;
mod sidebar;
mod terminal;
mod terminal_view;

use leptos::prelude::*;

use header::Header;
use new_session::NewSessionDialog;
use sidebar::Sidebar;
use terminal_view::TerminalPane;

fn main() {
  console_error_panic_hook::set_once();
  leptos::mount::mount_to_body(App);
}

/// Fetch terminal list from the API.
async fn fetch_terminals() -> Vec<kolu_common::Terminal> {
  let resp = gloo_net::http::Request::get("/api/terminals").send().await;
  match resp {
    Ok(r) if r.ok() => r.json().await.unwrap_or_default(),
    _ => vec![],
  }
}

/// Delete a terminal via the API.
async fn delete_terminal(id: &str) {
  let _ = gloo_net::http::Request::delete(&format!("/api/terminals/{}", id))
    .send()
    .await;
}

#[component]
fn App() -> impl IntoView {
  let (terminals, set_terminals) = signal(Vec::<kolu_common::Terminal>::new());
  let (active_id, set_active_id) = signal(Option::<String>::None);
  let (show_new_dialog, set_show_new_dialog) = signal(false);

  // Derive terminal IDs for TerminalPane
  let terminal_ids = Memo::new(move |_| {
    terminals
      .get()
      .iter()
      .map(|t| t.id.clone())
      .collect::<Vec<_>>()
  });

  // Initial fetch + set default active
  wasm_bindgen_futures::spawn_local(async move {
    let list = fetch_terminals().await;
    if !list.is_empty() && active_id.get_untracked().is_none() {
      set_active_id.set(Some(list[0].id.clone()));
    }
    set_terminals.set(list);
  });

  // Polling interval
  let poll_handle = gloo_timers::callback::Interval::new(2_000, move || {
    wasm_bindgen_futures::spawn_local(async move {
      let list = fetch_terminals().await;
      set_terminals.set(list);
    });
  });
  // Keep interval alive for component lifetime
  std::mem::forget(poll_handle);

  // Callbacks
  let on_new = Callback::new(move |()| {
    set_show_new_dialog.set(true);
  });

  let set_active_cb = Callback::new(move |id: Option<String>| {
    set_active_id.set(id);
  });

  let on_delete = Callback::new(move |id: String| {
    let active = active_id.get_untracked();
    wasm_bindgen_futures::spawn_local(async move {
      delete_terminal(&id).await;
      let list = fetch_terminals().await;
      // If we deleted the active terminal, switch to first available
      if active.as_deref() == Some(id.as_str()) {
        set_active_id.set(list.first().map(|t| t.id.clone()));
      }
      set_terminals.set(list);
    });
  });

  let on_created = Callback::new(move |id: String| {
    set_show_new_dialog.set(false);
    set_active_id.set(Some(id));
    // Refresh list
    wasm_bindgen_futures::spawn_local(async move {
      let list = fetch_terminals().await;
      set_terminals.set(list);
    });
  });

  let on_cancel = Callback::new(move |()| {
    set_show_new_dialog.set(false);
  });

  view! {
      <div class="flex flex-col w-full h-screen bg-slate-900">
          <Header />
          <div class="flex flex-1 min-h-0">
              <Sidebar
                  terminals=terminals
                  active_id=active_id
                  set_active_id=set_active_cb
                  on_new=on_new
                  on_delete=on_delete
              />
              <div class="flex-1 min-w-0 min-h-0 p-2">
                  <div class="w-full h-full border border-slate-600 rounded overflow-hidden">
                      <TerminalPane
                          terminal_ids=terminal_ids
                          active_id=active_id
                      />
                  </div>
              </div>
          </div>
          {move || show_new_dialog.get().then(|| view! {
              <NewSessionDialog
                  on_created=on_created
                  on_cancel=on_cancel
              />
          })}
      </div>
  }
}
