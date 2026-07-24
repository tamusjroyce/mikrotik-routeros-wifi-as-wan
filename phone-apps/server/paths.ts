import { fromFileUrl } from "https://deno.land/std@0.224.0/path/from_file_url.ts";

export const appRoot = new URL("../", import.meta.url);
export const repoRoot = new URL("../../", import.meta.url);
export const webRoot = new URL("../web/", import.meta.url);
export const defaultScriptPath = new URL(
  "../../mikrotek-scripts/enable-wifi-as-wan.rsc",
  import.meta.url,
);
export const defaultScriptFilePath = fromFileUrl(defaultScriptPath);
export const undoScriptPath = new URL(
  "../../mikrotek-scripts/undo-wifi-as-wan.rsc",
  import.meta.url,
);
export const undoScriptFilePath = fromFileUrl(undoScriptPath);
