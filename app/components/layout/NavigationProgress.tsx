import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

/**
 * H-07 — global top progress bar shown on ANY client-side navigation.
 * Tracks React Router's useNavigation() state: "idle" hides the bar; any
 * "loading" or "submitting" state shows it instantly (perceived speed) at a
 * fixed width that eases forward while loaders stream and completes + fades
 * on idle. Renders the wrapper ALWAYS (ar-Light: it's an aria-hidden
 * decorator; tests can observe the data-state attribute). Flat token color,
 * no spinner, RTL-safe.
 */
export function NavigationProgress() {
  const nav = useNavigation();
  const state = nav.state;
  const busy = state !== "idle";
  const [show, setShow] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (busy) {
      setShow(true);
      setComplete(false);
      return;
    }
    if (!show) return;
    setComplete(true);
    const t = setTimeout(() => {
      setShow(false);
      setComplete(false);
    }, 400);
    return () => clearTimeout(t);
  }, [busy, show]);

  const width = complete ? "100%" : state === "submitting" ? "55%" : "80%";
  return (
    <span
      data-testid="navigation-progress"
      data-state={state}
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-0.5 overflow-hidden"
    >
      {show ? (
        <span
          className="block h-full bg-action motion-reduce:transition-none"
          style={{
            width,
            transition: complete
              ? "width 160ms ease-out, opacity 260ms ease-out 80ms"
              : "width 600ms cubic-bezier(0.2, 0.8, 0.4, 1)",
            opacity: complete ? 0 : 1,
          }}
        />
      ) : null}
    </span>
  );
}
