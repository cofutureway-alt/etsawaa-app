import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { ensureLocale } from "~/lib/i18n/config";

// only the page's own language is downloaded; hydrate once it is in
const lang = document.documentElement.lang === "en" ? "en" : "ar";
void ensureLocale(lang).finally(() => {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydratedRouter />
      </StrictMode>,
    );
  });
});
