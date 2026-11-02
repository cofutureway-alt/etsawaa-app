import { useEffect, useRef, useState } from "react";
import { MapPin, type PinValue } from "~/components/checkout/MapPin";

/**
 * H-23 — shared SSR-safe location picker. Leaflet touches `window` at module
 * scope, so it must only mount in the browser: SSR and the first client paint
 * render a fixed-height skeleton (same box → CLS 0), then the real map swaps
 * in. Used by checkout (order pin) and the account address form (saved pin).
 */
export function LocationPicker({
  value,
  onChange,
  onStreet,
}: {
  value: PinValue | null;
  onChange: (v: PinValue | null) => void;
  /** receives the reverse-geocoded street (best-effort prefill). */
  onStreet?: (address: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const streetRef = useRef(onStreet);
  streetRef.current = onStreet;
  if (!mounted) {
    return (
      <div
        aria-hidden="true"
        className="h-64 w-full animate-pulse rounded-md border border-border bg-surface-tint motion-reduce:animate-none"
      />
    );
  }
  return <MapPin value={value} onChange={onChange} onStreet={(a) => streetRef.current?.(a)} />;
}
