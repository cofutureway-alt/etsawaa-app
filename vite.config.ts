import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  // Load .env into process.env so server-side code (loaders/actions) can read
  // secrets like RESEND_API_KEY in dev; production provides them via the host.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [reactRouter(), tailwindcss(), tsconfigPaths()],
    // The browser client (Realtime) reads VITE_*_SUPABASE_*; alias the two
    // public SUPABASE_* values onto it so .env stays single-source. Deliberately
    // explicit: a SUPABASE_ envPrefix would expose SUPABASE_SERVICE_ROLE_KEY.
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        env.VITE_SUPABASE_URL || env.SUPABASE_URL || "",
      ),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
        env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "",
      ),
      // SEO helpers build absolute URLs on the CLIENT too (meta() runs during
      // SPA navigations, where process.env does not exist)
      "import.meta.env.SITE_URL": JSON.stringify(env.SITE_URL || "http://localhost:3000"),
    },
  };
});
