//! New terminal dialog — label + command, POST to API.

use leptos::prelude::*;

/// Simple modal dialog for creating a new terminal.
#[component]
pub fn NewSessionDialog(
  #[prop(into)] on_created: Callback<String>,
  #[prop(into)] on_cancel: Callback<()>,
) -> impl IntoView {
  let (label, set_label) = signal(String::new());
  let (command, set_command) = signal(String::new());
  let (error, set_error) = signal(Option::<String>::None);
  let (submitting, set_submitting) = signal(false);

  let submit = move |e: web_sys::SubmitEvent| {
    e.prevent_default();
    let label_val = label.get_untracked();
    if label_val.is_empty() {
      set_error.set(Some("Label is required".to_string()));
      return;
    }
    let cmd_val = command.get_untracked();
    let cmd: Vec<String> = if cmd_val.is_empty() {
      vec!["bash".to_string()]
    } else {
      vec![cmd_val]
    };

    set_submitting.set(true);
    set_error.set(None);

    let on_created = on_created;
    let label_clone = label_val.clone();
    wasm_bindgen_futures::spawn_local(async move {
      match create_terminal(&label_clone, &cmd).await {
        Ok(()) => on_created.run(label_clone),
        Err(e) => {
          set_error.set(Some(e));
          set_submitting.set(false);
        }
      }
    });
  };

  view! {
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form
              class="bg-slate-800 rounded-lg p-4 w-80 border border-slate-600"
              on:submit=submit
          >
              <h2 class="text-sm font-semibold text-slate-200 mb-3">"New Terminal"</h2>

              <label class="block text-xs text-slate-400 mb-1">"Label"</label>
              <input
                  type="text"
                  class="w-full px-2 py-1 mb-2 rounded bg-slate-700 text-slate-200 text-sm border border-slate-600 focus:border-blue-500 outline-none"
                  placeholder="e.g. shell, htop"
                  prop:value=move || label.get()
                  on:input=move |e| set_label.set(event_target_value(&e))
                  autofocus=true
              />

              <label class="block text-xs text-slate-400 mb-1">"Command"</label>
              <input
                  type="text"
                  class="w-full px-2 py-1 mb-3 rounded bg-slate-700 text-slate-200 text-sm border border-slate-600 focus:border-blue-500 outline-none"
                  placeholder="default: bash"
                  prop:value=move || command.get()
                  on:input=move |e| set_command.set(event_target_value(&e))
              />

              {move || error.get().map(|e| view! {
                  <p class="text-red-400 text-xs mb-2">{e}</p>
              })}

              <div class="flex gap-2 justify-end">
                  <button
                      type="button"
                      class="px-3 py-1 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                      on:click=move |_| on_cancel.run(())
                  >
                      "Cancel"
                  </button>
                  <button
                      type="submit"
                      class="px-3 py-1 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                      disabled=move || submitting.get()
                  >
                      "Create"
                  </button>
              </div>
          </form>
      </div>
  }
}

/// POST /api/terminals to create a new terminal.
async fn create_terminal(label: &str, command: &[String]) -> Result<(), String> {
  let body = serde_json::json!({
      "label": label,
      "command": command,
  });

  let resp = gloo_net::http::Request::post("/api/terminals")
    .header("Content-Type", "application/json")
    .body(body.to_string())
    .map_err(|e| e.to_string())?
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if resp.ok() {
    Ok(())
  } else {
    let text = resp.text().await.unwrap_or_default();
    Err(text)
  }
}
