/**
 * Hosts an article may embed in an <iframe> (videos only). Shared by the
 * article sanitizer (lib/sanitize.ts) and the CSP frame-src (root.tsx) so the
 * two lists cannot drift apart; kept dependency-free for the root bundle.
 */
export const EMBED_HOSTS = [
  "www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com",
  "player.vimeo.com", "www.facebook.com", "www.tiktok.com",
] as const;
