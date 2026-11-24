import { PhoneInput } from "~/components/phone/PhoneInput";
import { useTranslation } from "react-i18next";
import { Input } from "~/components/ui/Input";
import { Button } from "~/components/ui/Button";
import { LocationPicker } from "~/components/location/LocationPicker";
import { GovernateAreaSelects } from "~/components/location/GovernateAreaSelects";
import type { StepViewState } from "~/components/checkout/StepHeader";
import { StepHeader } from "~/components/checkout/StepHeader";
import type { CheckoutAddressForm } from "~/features/checkout/useCheckoutAddressForm";
import type { CheckoutAddressRow, CheckoutAreaRow, CheckoutGovernorateRow } from "~/features/checkout/types";

/**
 * Step 1 — account & address accordion section (JOURNEYS §6).
 *
 * The email is displayed READ-ONLY (AGENT §29); saved addresses are picked
 * from a radio list, a new address is typed inline, and the optional delivery
 * pin (L-20/H-23) applies in BOTH modes. All state lives in the
 * `useCheckoutAddressForm` hook — this component is its rendering.
 * SSR-safe shared map lives in ~/components/location/LocationPicker (H-23).
 */

export function AddressStep({
  addr,
  open,
  index,
  total,
  stepState,
  onOpen,
  onContinue,
  lang,
  viewerEmail,
  addresses,
  governorates,
  areas,
}: {
  addr: CheckoutAddressForm;
  open: boolean;
  index: number;
  total: number;
  stepState: StepViewState;
  onOpen: () => void;
  /** Continue button: validates + advances to the shipping step */
  onContinue: () => void;
  lang: string;
  viewerEmail: string;
  addresses: CheckoutAddressRow[];
  governorates: CheckoutGovernorateRow[];
  areas: CheckoutAreaRow[];
}) {
  const { t, i18n } = useTranslation();
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
      <StepHeader index={index} total={total} state={stepState} open={open} onOpen={onOpen} />
      {open ? (
        <div className="border-t border-border p-4">
          {/* email: displayed read-only, never an input (AGENT §29) */}
          <div className="mb-4 rounded-md bg-surface-tint p-3">
            <p className="text-sm font-bold text-text">{t("checkout.emailLabel")}</p>
            <p className="text-sm text-text-muted">{viewerEmail}</p>
            <p className="mt-1 text-xs text-text-faint">{t("checkout.emailReadOnly")}</p>
          </div>

          {addresses.length > 0 ? (
            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-bold text-text">{t("checkout.savedAddresses")}</legend>
              <div className="flex flex-col gap-2">
                {addresses.map((a) => (
                  <label
                    key={a.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors duration-150 ${
                      addr.addressMode === "saved" && addr.selectedAddressId === a.id ? "border-action bg-surface-tint" : "border-border hover:border-primary"
                    }`}
                  >
                    <input
                      type="radio"
                      name="saved-address"
                      className="mt-1 size-4 accent-[var(--color-action)]"
                      checked={addr.addressMode === "saved" && addr.selectedAddressId === a.id}
                      onChange={() => { addr.setAddressMode("saved"); addr.setSelectedAddressId(a.id); addr.setPinDirty(false); }}
                    />
                    <span className="text-sm">
                      <span className="font-bold text-text">
                        {a.full_name}
                        {a.is_default ? <span className="ms-2 rounded-md bg-surface-tint px-1.5 py-0.5 text-2xs font-bold text-text-muted">{t("checkout.defaultAddress")}</span> : null}
                      </span>
                      <span className="mt-0.5 block text-sm text-text-muted" dir="ltr">
                        {a.phone}
                      </span>
                      <span className="mt-0.5 block text-sm text-text-muted">
                        {a.address1}{a.address2 ? `، ${a.address2}` : ""}
                        {` — ${governorates.find((g) => g.id === a.governorate_id)?.[i18n.language?.startsWith("en") ? "name_en" : "name_ar"] ?? ""} · ${areas.find((x) => x.id === a.area_id)?.[i18n.language?.startsWith("en") ? "name_en" : "name_ar"] ?? ""}`}
                      </span>
                    </span>
                  </label>
                ))}
                <label className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors duration-150 ${addr.addressMode === "new" ? "border-action bg-surface-tint" : "border-border hover:border-primary"}`}>
                  <input
                    type="radio"
                    name="saved-address"
                    className="size-4 accent-[var(--color-action)]"
                    checked={addr.addressMode === "new"}
                    onChange={() => { addr.setAddressMode("new"); addr.setPinDirty(false); }}
                  />
                  <span className="text-sm font-bold text-text">{t("checkout.newAddress")}</span>
                </label>
              </div>
            </fieldset>
          ) : null}

          {addr.addressMode === "new" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id="ck-name" label={t("checkout.fullName")} required
                value={addr.fullName} onChange={(e) => addr.setFullName(e.target.value)}
                onBlur={() => addr.blur("full_name")} error={addr.err("full_name")}
                autoComplete="name"
              />
              <PhoneInput
                id="ck-phone1" label={t("checkout.primaryPhone")} required
                value={addr.primaryPhone} onChange={(e) => addr.setPrimaryPhone(e.target.value)}
                onBlur={() => addr.blur("phone_primary")} error={addr.err("phone_primary")} autoComplete="tel"
              />
              <PhoneInput
                id="ck-phone2" label={t("checkout.alternatePhone")} required
                value={addr.alternatePhone} onChange={(e) => addr.setAlternatePhone(e.target.value)}
                onBlur={() => addr.blur("phone_alternate")} error={addr.err("phone_alternate")}
                hint={t("checkout.alternateHint")}
              />
              {/* H-22: governorate→area dependent (abort + session cache);
                  the pair is re-verified on the server inside the action */}
              <div className="sm:col-span-2">
                <GovernateAreaSelects
                  lang={lang}
                  governorates={governorates}
                  governorateId={addr.govId ? String(addr.govId) : ""}
                  areaId={addr.areaId ? String(addr.areaId) : ""}
                  onGovernorateChange={(v) => {
                    addr.setGovId(v ? Number(v) : null);
                    addr.setAreaId(null);
                    addr.blur("governorate");
                  }}
                  onAreaChange={(v) => { addr.setAreaId(v ? Number(v) : null); addr.blur("area"); }}
                  initialAreas={areas}
                  govError={addr.err("governorate")}
                  areaError={addr.err("area")}
                />
              </div>
              <Input
                id="ck-addr1" label={t("checkout.address1")} required className="sm:col-span-2"
                value={addr.addr1} onChange={(e) => addr.setAddr1(e.target.value)}
                onBlur={() => addr.blur("address1")} error={addr.err("address1")}
                autoComplete="address-line1"
              />
              <Input
                id="ck-addr2" label={`${t("checkout.address2")} (${t("checkout.optional")})`}
                value={addr.addr2} onChange={(e) => addr.setAddr2(e.target.value)}
                autoComplete="address-line2"
              />
              <Input
                id="ck-postal" label={`${t("checkout.postal")} (${t("checkout.optional")})`}
                value={addr.postal} onChange={(e) => addr.setPostal(e.target.value)}
                inputMode="numeric"
              />
            </div>
          ) : null}

          {/* L-20/H-23 — optional delivery pin (both address modes).
              A saved address with a stored pin pre-places the marker. */}
          <div className="mt-3">
            <p className="mb-1.5 text-sm font-bold text-text">
              {t("map.title")} <span className="font-normal text-text-faint">({t("checkout.optional")})</span>
            </p>
            <LocationPicker value={addr.pin} onChange={(v) => { addr.setPinDirty(true); addr.setPin(v); }} onStreet={addr.prefillFromPin} />
          </div>

          {/* alternate phone is required even for saved addresses */}
          {addr.addressMode === "saved" ? (
            <div className="mt-1 max-w-sm">
              <PhoneInput
                id="ck-phone2-saved" label={t("checkout.alternatePhone")} required
                value={addr.alternatePhone} onChange={(e) => addr.setAlternatePhone(e.target.value)}
                onBlur={() => addr.blur("phone_alternate")} error={addr.err("phone_alternate")}
                hint={t("checkout.alternateHint")}
              />
            </div>
          ) : null}

          <div className="mt-4 flex justify-end">
            <Button onClick={onContinue}>
              {t("checkout.continue")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
