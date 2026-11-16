// The diagram frame's two assets, loaded through the consuming app's bundler
// (Vite): mermaid's prebuilt single file as a URL (fetched by the page, run
// only inside the sandboxed renderer frames), and the frame's program as text. These
// declarations let the package typecheck on its own.
declare module "mermaid/dist/mermaid.min.js?url" {
  const url: string;
  export default url;
}

declare module "*/diagram-frame-program.js?raw" {
  const source: string;
  export default source;
}
