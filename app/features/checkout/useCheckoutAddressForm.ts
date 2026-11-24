import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PinValue } from "~/components/checkout/MapPin";
import { normalizeEgyptianPhone } from "~/lib/phone";
import type { CheckoutAddressRow } from "~/features/checkout/types";

/**
 * Address-form state for checkout (JOURNEYS §6): saved-vs-new mode, every
 * inline field, the delivery pin and the touched/error bookkeeping — plus the
 * H-21/H-23 prefill effects that keep alternate phone and map pin in sync
 * with the selected saved address.
 *
 * Extracted from `app/routes/checkout.tsx` verbatim; the deps-narrowing
 * eslint-disables moved with their effects on purpose.
 */

export interface CheckoutAddressFormInput {
  addresses: CheckoutAddressRow[];
  /** profile primary phone — seeds the new-address form */
  profilePhone: string;
  /** H-21: profile alternate phone — seeds a NEW address's alternate field */
  profileAlternatePhone: string;
}

/** Everything the address step, the placement submit and the step header need. */
export interface CheckoutAddressForm {
  /** "saved" = pick from saved addresses, "new" = inline address form */
  addressMode: "saved" | "new";
  setAddressMode: (mode: "saved" | "new") => void;
  selectedAddressId: string;
  setSelectedAddressId: (id: string) => void;
  /** the SELECTED saved address (drives alternate-phone prefill + saved pin reuse) */
  selectedAddress: CheckoutAddressRow | undefined;
  /** first default address — confirm-step summary fallback */
  defaultAddress: CheckoutAddressRow | undefined;
  fullName: string;
  setFullName: (v: string) => void;
  primaryPhone: string;
  setPrimaryPhone: (v: string) => void;
  alternatePhone: string;
  setAlternatePhone: (v: string) => void;
  govId: number | null;
  setGovId: (v: number | null) => void;
  areaId: number | null;
  setAreaId: (v: number | null) => void;
  addr1: string;
  setAddr1: (v: string) => void;
  addr2: string;
  setAddr2: (v: string) => void;
  postal: string;
  setPostal: (v: string) => void;
  /** L-20/H-23 — optional delivery pin (both address modes) */
  pin: PinValue | null;
  setPin: (v: PinValue | null) => void;
  /** true once the user manually moved/cleared the map pin */
  setPinDirty: (dirty: boolean) => void;
  /** reverse-geocoded street → best-effort address1 prefill (new mode only) */
  prefillFromPin: (street: string) => void;
  /** inline validation message for a touched field, undefined when valid */
  err: (field: string) => string | undefined;
  /** mark a field touched (on blur) so its error shows */
  blur: (field: string) => void;
  /** mark every address field touched (address-step Continue button) */
  touchAll: () => void;
  /** address step counts as complete (drives the accordion state bubble) */
  addressDone: boolean;
}

export function useCheckoutAddressForm({
  addresses, profilePhone, profileAlternatePhone,
}: CheckoutAddressFormInput): CheckoutAddressForm {
  const { t } = useTranslation();

  // ---- address form state
  const [addressMode, setAddressMode] = useState<"saved" | "new">(
    addresses.length > 0 ? "saved" : "new",
  );
  const defaultAddress = addresses.find((a) => a.is_default) ?? addresses[0];
  const [selectedAddressId, setSelectedAddressId] = useState<string>(defaultAddress?.id ?? "");
  const selectedAddress = addresses.find((a) => a.id === selectedAddressId) ?? defaultAddress;
  const [fullName, setFullName] = useState(defaultAddress?.full_name ?? "");
  const [primaryPhone, setPrimaryPhone] = useState(defaultAddress?.phone ?? profilePhone);
  // H-21: prefilled from the saved address (or the profile for a new address)
  const [alternatePhone, setAlternatePhone] = useState("");
  const [pinDirty, setPinDirty] = useState(false);
  const [govId, setGovId] = useState<number | null>(defaultAddress?.governorate_id ?? null);
  const [areaId, setAreaId] = useState<number | null>(defaultAddress?.area_id ?? null);
  const [addr1, setAddr1] = useState(defaultAddress?.address1 ?? "");
  const [addr2, setAddr2] = useState(defaultAddress?.address2 ?? "");
  const [postal, setPostal] = useState(defaultAddress?.postal_code ?? "");
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // ---- delivery pin: H-23 — a saved address WITH a stored pin provides the
  // map's starting marker; the user may move/clear it (pinDirty = user edit)
  const [pin, setPin] = useState<PinValue | null>(null);
  const prefillFromPin = (street: string) => {
    if (addressMode === "new" && !addr1.trim()) {
      setAddr1((prev) => (prev.trim() ? prev : street));
    }
  };

  /* H-21/H-23 — when the selected saved address (or the mode) changes:
     - the alternate phone pre-fills from the saved address (user-editable;
       checkout still validates it server-side)
     - the map pin pre-fills from the address's stored pin unless the user
       already moved/cleared it manually (pinDirty) */
  useEffect(() => {
    if (addressMode === "saved") {
      setAlternatePhone(selectedAddress?.phone_alternate ?? "");
      if (!pinDirty) {
        setPin(
          selectedAddress && selectedAddress.lat != null && selectedAddress.lng != null
            ? { lat: selectedAddress.lat, lng: selectedAddress.lng, accuracyM: selectedAddress.geo_accuracy }
            : null,
        );
      }
    }
    // Deps stay narrow on purpose: adding `pinDirty` would re-run the effect
    // on every pin move and clobber a user-edited alternate phone; the
    // prefill must fire only when the selected address changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressMode, selectedAddressId]);

  /* H-21 — a NEW address starts from the profile's saved alternate phone. */
  useEffect(() => {
    if (addressMode === "new" && !alternatePhone) {
      setAlternatePhone(profileAlternatePhone ?? "");
    }
    // Deps stay narrow on purpose: adding `alternatePhone` would auto-refill
    // from the profile after the user deliberately clears the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressMode]);

  const err = (field: string): string | undefined => {
    if (!touched[field]) return undefined;
    switch (field) {
      case "full_name": return fullName.trim() ? undefined : t("checkout.errName");
      case "phone_primary": return primaryPhone.trim() ? (normalizeEgyptianPhone(primaryPhone).ok ? undefined : t("checkout.errPhone")) : t("checkout.errPhoneRequired");
      case "phone_alternate": {
        if (!alternatePhone.trim()) return t("checkout.errAlternateRequired");
        const a = normalizeEgyptianPhone(alternatePhone);
        if (!a.ok) return t("checkout.errPhone");
        const p = normalizeEgyptianPhone(primaryPhone);
        if (p.ok && a.e164 === p.e164) return t("checkout.errPhonesEqual");
        return undefined;
      }
      case "governorate": return govId ? undefined : t("checkout.errGovernorate");
      case "area": return areaId ? undefined : t("checkout.errArea");
      case "address1": return addr1.trim() ? undefined : t("checkout.errAddress1");
      default: return undefined;
    }
  };
  const blur = (field: string) => setTouched((s) => ({ ...s, [field]: true }));
  const touchAll = () =>
    setTouched({ full_name: true, phone_primary: true, phone_alternate: true, governorate: true, area: true, address1: true });

  const addressDone = addressMode === "saved"
    ? selectedAddressId !== "" && err("phone_alternate") === undefined && Boolean(alternatePhone)
    : Boolean(fullName && addr1 && govId && areaId && alternatePhone && err("phone_primary") === undefined && err("phone_alternate") === undefined);

  return {
    addressMode,
    setAddressMode: (mode) => void setAddressMode(mode),
    selectedAddressId,
    setSelectedAddressId: (id) => void setSelectedAddressId(id),
    selectedAddress,
    defaultAddress,
    fullName,
    setFullName: (v) => void setFullName(v),
    primaryPhone,
    setPrimaryPhone: (v) => void setPrimaryPhone(v),
    alternatePhone,
    setAlternatePhone: (v) => void setAlternatePhone(v),
    govId,
    setGovId: (v) => void setGovId(v),
    areaId,
    setAreaId: (v) => void setAreaId(v),
    addr1,
    setAddr1: (v) => void setAddr1(v),
    addr2,
    setAddr2: (v) => void setAddr2(v),
    postal,
    setPostal: (v) => void setPostal(v),
    pin,
    setPin: (v) => void setPin(v),
    setPinDirty: (dirty) => void setPinDirty(dirty),
    prefillFromPin,
    err,
    blur,
    touchAll,
    addressDone,
  };
}
