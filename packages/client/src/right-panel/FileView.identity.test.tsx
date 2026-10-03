import { FileView } from "@kolu/solid-fileview";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { expect, it } from "vitest";

it("keeps the source element across file saves and rendered-mode toggles", () => {
  for (const both of [false, true]) {
    const host = document.createElement("div");
    document.body.append(host);
    const [file, setFile] = createSignal({ path: "note.md", source: { content: "first", truncated: false } });
    let mounts = 0;
    const source = { render: (read: typeof file) => { mounts++; return <pre data-source="">{read().source.content}</pre>; } };
    const dispose = render(() => <FileView file={file()} source={source} defaultMode="source"
      rendered={both ? [{ match: () => true, render: (read) => <article>{read().source.content}</article> }] : undefined} />, host);
    try {
      const element = host.querySelector("pre")!;
      setFile({ ...file(), source: { content: "saved", truncated: false } });
      expect(host.querySelector("pre")).toBe(element);
      expect(element.textContent).toBe("saved");
      if (both) {
        host.querySelector<HTMLButtonElement>("[data-testid=fileview-toggle-rendered]")!.click();
        host.querySelector<HTMLButtonElement>("[data-testid=fileview-toggle-source]")!.click();
        expect(host.querySelector("pre")).toBe(element);
      }
      expect(mounts).toBe(1);
    } finally { dispose(); host.remove(); }
  }
});
