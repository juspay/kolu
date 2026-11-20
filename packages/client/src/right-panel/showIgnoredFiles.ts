import { boolPref } from "../persistedPref";

export const [showIgnoredFiles, setShowIgnoredFiles] = boolPref({
  name: "kolu-code-tab-show-ignored",
  fallback: false,
});
