/**
 * OTP screen helpers (pure — covered by tests/otp-cooldown.test.ts).
 * Supabase Auth enforces the server-side throttle; this drives the visible
 * resend countdown and the disabled state of the resend button.
 */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export function resendSecondsLeft(startedAtMs: number, nowMs: number): number {
  const elapsedSeconds = Math.floor((nowMs - startedAtMs) / 1000);
  return Math.max(0, OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
}

export function formatCooldown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
