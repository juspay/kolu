/** Type declaration for the terminal-themes virtual module (resolved via Vite alias). */
declare module "ghostty-themes" {
  import type { ITheme } from "@xterm/xterm";
  const themes: Array<{ name: string; theme: ITheme }>;
  export default themes;
}
