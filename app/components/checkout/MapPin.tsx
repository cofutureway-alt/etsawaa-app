import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon } from "~/components/ui/icons";
import { Button } from "~/components/ui/Button";

/**
 * L-20 — Delivery map pin (checkout, address accordion).
 * Leaflet + OpenStreetMap, loaded DYNAMICALLY after mount (it touches
 * `window` at module scope — a static import would crash SSR). Draggable pin
 * + "use my location" + optional Photon (OSM) reverse-geocode that PREFILLS
 * the street into address1 (best-effort; the typed address always wins).
 * The chosen coordinates live in checkout form state, not here.
 */

export interface PinValue {
  lat: number;
  lng: number;
  accuracyM: number | null;
}

export const EGYPT_CENTER: [number, number] = [30.0444, 31.2357];

/** Minimal structural types for the pieces of Leaflet we use. */
interface LeafLike {
  map: (el: HTMLElement, opts: Record<string, unknown>) => LeafMapLike;
  tileLayer: (url: string, opts: Record<string, unknown>) => { addTo: (m: LeafMapLike) => void };
  marker: (ll: [number, number], opts: Record<string, unknown>) => LeafMarkerLike;
  divIcon: (opts: Record<string, unknown>) => unknown;
}
interface LeafMapLike {
  setView: (ll: [number, number], zoom?: number) => void;
  getZoom: () => number;
  invalidateSize: (opts?: { animate?: boolean }) => void;
  on: (ev: string, fn: (e: { latlng: { lat: number; lng: number } }) => void) => void;
  off: (ev: string, fn: (e: { latlng: { lat: number; lng: number } }) => void) => void;
  remove: () => void;
}
interface LeafMarkerLike {
  setLatLng: (ll: [number, number]) => void;
  getLatLng: () => { lat: number; lng: number };
  on: (ev: string, fn: () => void) => void;
  addTo: (m: LeafMapLike) => void;
  remove: () => void;
}

let L: LeafLike | null = null;
let cssLoaded = false;

/** Leaflet's stylesheet is REQUIRED for panes/tiles to position correctly — without
 *  it every tile piles up and the map looks like overlapping fragments. Loaded
 *  together with the library (client-only, idempotent). */
async function loadLeaflet(): Promise<LeafLike> {
  if (!cssLoaded) {
    await import("leaflet/dist/leaflet.css");
    cssLoaded = true;
  }
  if (L) return L;
  const mod = (await import(/* @vite-ignore */ "leaflet")) as unknown as { default: LeafLike } & LeafLike;
  L = (mod.default ?? mod) as LeafLike;
  return L;
}

export function MapPin({
  value,
  onChange,
  onStreet,
}: {
  value: PinValue | null;
  onChange: (v: PinValue | null) => void;
  /** receives the reverse-geocoded street so checkout can prefill address1 */
  onStreet?: (address: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafMapLike | null>(null);
  const markerRef = useRef<LeafMarkerLike | null>(null);
  const [ready, setReady] = useState(false);
  const [busyGeo, setBusyGeo] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const lang = i18n.language?.startsWith("en") ? "en" : "ar";

  // publish the pin upward
  const publish = (lat: number, lng: number, accuracyM: number | null) => {
    onChangeRef.current({ lat, lng, accuracyM });
  };

  // best-effort Photon reverse-geocode → street prefill
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=${lang}&limit=1`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        features?: Array<{ properties?: { name?: string; street?: string; district?: string; city?: string } }>;
      };
      const p = body.features?.[0]?.properties;
      const street = [p?.street ?? p?.name, p?.district].filter(Boolean).join("، ");
      if (street) onStreet?.(street);
    } catch {
      // prefill is optional
    }
  };

  // init once
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    void (async () => {
      if (!divRef.current) return;
      const leaflet = await loadLeaflet();
      if (cancelled || !divRef.current) return;
      const map = leaflet.map(divRef.current, {
        center: EGYPT_CENTER,
        zoom: 12,
        scrollWheelZoom: false, // native page scroll on touch/one-handed use
      });
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        })
        .addTo(map);
      mapRef.current = map;
      const onMapClick = (e: { latlng: { lat: number; lng: number } }) => {
        placeMarker(e.latlng.lat, e.latlng.lng, valueRef.current?.accuracyM ?? null);
      };
      map.on("click", onMapClick);
      // the container width settles AFTER the accordion animation — tell
      // Leaflet to re-measure or tiles render against a stale size
      requestAnimationFrame(() => map.invalidateSize());
      setReady(true);
      cleanup = () => {
        map.off("click", onMapClick);
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      };
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function placeMarker(lat: number, lng: number, accuracy: number | null) {
    const leaflet = L;
    const map = mapRef.current;
    if (!leaflet || !map) return;
    const icon = leaflet.divIcon({
      className: "",
      html: '<span aria-hidden="true" style="display:block;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--color-action);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>',
      iconSize: [26, 26],
      iconAnchor: [13, 26],
    });
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      const marker = leaflet.marker([lat, lng], { icon, draggable: true, keyboard: true });
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        publish(p.lat, p.lng, valueRef.current?.accuracyM ?? null);
        void reverseGeocode(p.lat, p.lng);
      });
      marker.addTo(map);
      markerRef.current = marker;
    }
    map.setView([lat, lng], Math.max(map.getZoom(), 15));
    publish(lat, lng, accuracy);
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setGeoError(t("map.unsupported"));
      return;
    }
    setBusyGeo(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusyGeo(false);
        const { latitude, longitude, accuracy } = pos.coords;
        const acc = Number.isFinite(accuracy) ? Math.min(5000, Math.max(1, Math.round(accuracy))) : null;
        placeMarker(latitude, longitude, acc);
        void reverseGeocode(latitude, longitude);
      },
      () => {
        setBusyGeo(false);
        setGeoError(t("map.denied"));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={useMyLocation} disabled={busyGeo}>
          {busyGeo ? "…" : t("map.useMyLocation")}
        </Button>
        {value ? (
          <>
            <span
              className="inline-flex items-center gap-1.5 rounded-s border border-success/40 bg-success-soft px-2.5 py-1 text-xs font-bold text-success"
              role="status"
            >
              <CheckIcon aria-hidden="true" className="size-3.5" />
              {t("map.pinSet")}
              <span className="num font-normal text-text-muted" dir="ltr">
                {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
                {value.accuracyM ? ` ±${value.accuracyM}m` : ""}
              </span>
            </span>
            <button
              type="button"
              className="cursor-pointer text-xs font-bold text-danger hover:underline"
              onClick={() => {
                markerRef.current?.remove();
                markerRef.current = null;
                onChangeRef.current(null);
              }}
            >
              {t("map.clear")}
            </button>
          </>
        ) : (
          <span className="text-xs text-text-faint">{t("map.noPin")}</span>
        )}
      </div>
      {geoError ? <p role="alert" className="text-xs font-bold text-danger">{geoError}</p> : null}
      {/* ONE fixed-height container — CLS stays 0 and Leaflet always measures
          the same box; `relative` pins the tile panes inside it */}
      <div
        ref={divRef}
        aria-describedby="map-help"
        role="application"
        aria-label={t("map.aria")}
        className="relative h-56 w-full overflow-hidden rounded-m border border-border sm:h-72"
        dir="ltr"
      />
      <p id="map-help" className="text-xs text-text-muted">{t("map.help")}</p>
      {!ready ? <p className="text-[11px] text-text-faint">{t("map.loading")}</p> : null}
      <p className="text-[11px] text-text-faint">{t("map.tapHint")}</p>
    </div>
  );
}
