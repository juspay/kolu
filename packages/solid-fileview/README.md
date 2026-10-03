# @kolu/solid-fileview

`FileView` selects injected source and rendered appliances and owns their
Source / Rendered toggle. Concrete image, video, PDF, iframe and Markdown
renderers are available through the package's `./renderers/*` exports.

`SourceRenderer<T>.render` and `RenderedRenderer<T>.render` receive an
`Accessor<T>`. Read it in JSX bindings so file saves update the mounted view:

```tsx
const source = {
  render: (file: Accessor<FileWithSource>) => <pre>{file().source.content}</pre>,
};
<FileView file={currentFile()} source={source} />;
```

A single-form file retains its appliance while the selected renderer is the
same object. Two-form files mount each mode on first use and retain it across
toggles. A hidden mode holds its previous file until revealed. Keep renderer
objects stable; changing the renderer selects a different appliance.
