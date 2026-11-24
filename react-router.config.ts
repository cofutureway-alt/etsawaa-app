import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  // Production runs behind Cloudflare → Caddy (TLS) → Node over plain HTTP, so
  // the app sees request.url as http://etsawaa.com while browsers send
  // Origin: https://etsawaa.com. React Router's CSRF check compares the two
  // and rejected every action (400 Bad Request). Trust our own host.
  allowedActionOrigins: ["etsawaa.com", "www.etsawaa.com"],
} satisfies Config;
