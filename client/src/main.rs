use leptos::prelude::*;

fn main() {
    leptos::mount::mount_to_body(App);
}

#[component]
fn App() -> impl IntoView {
    view! {
        <div class="min-h-screen bg-slate-900 text-slate-200 flex flex-col items-center justify-center gap-6">
            <img src="/favicon.svg" alt="kolu" class="w-24 h-24" />
            <h1 class="text-4xl font-bold">{kolu_common::hello()}</h1>
        </div>
    }
}
