import { registerLocale } from "./config";
import { ar } from "./ar";
import { en } from "./en";

/** Server: both languages, registered once at boot (imported by entry.server). */
registerLocale("ar", ar);
registerLocale("en", en);
