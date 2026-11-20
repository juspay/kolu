import { attachBackForwardMouse } from "@kolu/solid-browser";
import { For, onCleanup, Show } from "solid-js";
import { createDocSite } from "../docsite";
import { DOCS, HOME } from "./docs";

export default function App() {
  const site = createDocSite(DOCS, HOME);

  onCleanup(
    attachBackForwardMouse(window, {
      onBack: () => site.back(),
      onForward: () => site.forward(),
    }),
  );

  return (
    <div class="app">
      <header class="chrome">
        <button
          type="button"
          class="nav"
          aria-label="Go back"
          title="Back"
          disabled={!site.canBack()}
          onClick={() => site.back()}
        >
          ◀
        </button>
        <button
          type="button"
          class="nav"
          aria-label="Go forward"
          title="Forward"
          disabled={!site.canForward()}
          onClick={() => site.forward()}
        >
          ▶
        </button>
        <span class="addr">docsite://{site.currentSlug() ?? ""}</span>
        <span class="brand">@kolu/solid-browser · createBrowser</span>
      </header>

      <div class="body">
        <nav class="toc">
          <div class="toc-title">Pages</div>
          <For each={Object.entries(DOCS)}>
            {([slug, doc]) => (
              <button
                type="button"
                class="toc-link"
                classList={{ active: site.currentSlug() === slug }}
                onClick={() => site.open(slug)}
              >
                {doc.title}
              </button>
            )}
          </For>
        </nav>

        <main class="doc">
          <Show when={site.currentDoc()} fallback={<p>Nothing open.</p>}>
            {(doc) => (
              <article>
                <h1>{doc().title}</h1>
                <For each={doc().body.split("\n\n")}>
                  {(para) => <p>{para}</p>}
                </For>
                <Show when={doc().links.length > 0}>
                  <div class="read-next">
                    <span class="read-next-label">Read next</span>
                    <For each={doc().links}>
                      {(slug) => (
                        <button
                          type="button"
                          class="read-next-link"
                          onClick={() => site.open(slug)}
                        >
                          {DOCS[slug]?.title ?? slug} →
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </article>
            )}
          </Show>
        </main>
      </div>

      <footer class="foot">
        The ◀ ▶ buttons are <code>createBrowser.canBack()</code> /{" "}
        <code>canForward()</code>; following a link is <code>navigate()</code>.
        Your mouse's back/forward buttons work here too. None of it is written
        in this app — it's the same history controller kolu's Code tab runs.
      </footer>
    </div>
  );
}
