/** Type declaration for the ghostty-themes virtual module (resolved via Vite alias). */
declare module "ghostty-themes" {
  import type { ITheme } from "ghostty-web";
  const themes: Array<{ name: string; theme: ITheme }>;
  export default themes;
}
