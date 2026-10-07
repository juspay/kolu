// The logo is imported as text (Vite's `?raw`) and inlined, so its strokes can
// take `currentColor`. The consuming app's bundler (Vite) supplies the loader;
// this declaration lets the package typecheck on its own.
declare module "*.svg?raw" {
  const source: string;
  export default source;
}
