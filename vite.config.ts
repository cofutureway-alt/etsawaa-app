import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const ASSET_REV = "r2";

export default defineConfig(({ mode }) => {
  // Load .env into process.env so server-side code (loaders/actions) can read
  // secrets like RESEND_API_KEY in dev; production provides them via the host.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [reactRouter(), tailwindcss(), tsconfigPaths()],
    // ASSET_REV is part of every built file name. Bump it to give all JS/CSS
    // new URLs when browsers may hold bad cached copies (e.g. 404s cached
    // during a broken deploy: the same content would otherwise keep the same
    // hashed name and the stale 404 would stick).
    build: {
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name]-[hash]-${ASSET_REV}.js`,
          chunkFileNames: `assets/[name]-[hash]-${ASSET_REV}.js`,
          assetFileNames: `assets/[name]-[hash]-${ASSET_REV}[extname]`,
        },
      },
    },
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
