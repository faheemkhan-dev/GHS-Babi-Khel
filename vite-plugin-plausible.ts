// vite-plugin-plausible.ts
//
// Vite plugin that injects the Plausible <script> tag into index.html
// at build time when VITE_PLAUSIBLE_DOMAIN is set.
//
// Vite does NOT auto-populate process.env with VITE_* values, so we must
// call loadEnv() in the config hook to read them from .env files.

import type { Plugin } from "vite";
import { loadEnv } from "vite";

export function plausiblePlugin(): Plugin {
  let domain = "";
  let src = "https://plausible.io/js/script.js";

  return {
    name: "vite-plugin-plausible",
    config(_config, { mode }) {
      const env = loadEnv(mode, process.cwd(), "");
      domain = (env.VITE_PLAUSIBLE_DOMAIN || process.env.VITE_PLAUSIBLE_DOMAIN || "").trim();
      src = (env.VITE_PLAUSIBLE_SRC || process.env.VITE_PLAUSIBLE_SRC || src).trim();
    },
    transformIndexHtml(html) {
      const placeholder = "<!-- PLAUSIBLE_INJECT_PLACEHOLDER -->";

      if (!domain) {
        return html.replace(
          placeholder,
          "<!-- Plausible: set VITE_PLAUSIBLE_DOMAIN to enable -->"
        );
      }

      const tag = `<!-- Plausible Analytics (auto-injected by vite-plugin-plausible) -->
    <script
      id="plausible-script"
      defer
      data-domain="${domain}"
      src="${src}"
    ></script>`;

      return html.replace(placeholder, tag);
    },
  };
}
