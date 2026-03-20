//! App header with branding.

use leptos::prelude::*;

/// Top bar showing the app logo and name.
#[component]
pub fn Header() -> impl IntoView {
  view! {
      <header class="flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700">
          <img src="/favicon.svg" alt="kolu" class="w-6 h-6" />
          <span class="text-sm font-semibold text-slate-300">{kolu_common::hello()}</span>
      </header>
  }
}
