import { PhoneInput } from "~/components/phone/PhoneInput";
import { useTranslation } from "react-i18next";
import { Input, Select } from "~/components/ui";
import { SOCIAL_PLATFORMS } from "~/features/vendor/schemas";
import type { GovRow, AreaRow } from "../server";
import type { FormState, OnboardingPatch } from "../useOnboarding";

/**
 * step2-details.tsx — wizard step 2 "details": owner name, phone, governorate/
 * area selects, address and the five social links. Receives the already
 * governorate-filtered area list from the page (same filter as before).
 */

export function Step2Details({
  form,
  governorates,
  areas,
  isAr,
  patch,
}: {
  form: FormState;
  governorates: GovRow[];
  areas: AreaRow[];
  isAr: boolean;
  patch: OnboardingPatch;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="first_name"
          label={t("vendorOnboarding.step2.firstName")}
          value={form.first_name}
          onChange={(e) => patch({ first_name: e.target.value })}
          required
        />
        <Input
          id="last_name"
          label={t("vendorOnboarding.step2.lastName")}
          value={form.last_name}
          onChange={(e) => patch({ last_name: e.target.value })}
          required
        />
      </div>
      <PhoneInput
        id="phone"
        label={t("vendorOnboarding.step2.phone")}
        value={form.phone}
        onChange={(e) => patch({ phone: e.target.value })}
        required
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="governorate_id"
          required
          label={t("vendorOnboarding.step2.governorate")}
          value={form.governorate_id ? String(form.governorate_id) : ""}
          onChange={(e) => patch({ governorate_id: e.target.value ? Number(e.target.value) : null, area_id: null })}
          options={[
            { value: "", label: t("common.choose") },
            ...governorates.map((g) => ({ value: String(g.id), label: isAr ? g.name_ar : g.name_en })),
          ]}
        />
        <Select
          id="area_id"
          required
          label={t("vendorOnboarding.step2.area")}
          value={form.area_id ? String(form.area_id) : ""}
          disabled={!form.governorate_id}
          onChange={(e) => patch({ area_id: e.target.value ? Number(e.target.value) : null })}
          options={[
            { value: "", label: t("common.choose") },
            ...areas.map((a) => ({ value: String(a.id), label: isAr ? a.name_ar : a.name_en })),
          ]}
        />
      </div>
      <Input
        id="address1"
        label={t("vendorOnboarding.step2.address1")}
        value={form.address1}
        onChange={(e) => patch({ address1: e.target.value })}
        required
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="address2"
          label={t("vendorOnboarding.step2.address2")}
          value={form.address2}
          onChange={(e) => patch({ address2: e.target.value })}
        />
        <Input
          id="postal_code"
          label={t("vendorOnboarding.step2.postal")}
          value={form.postal_code}
          onChange={(e) => patch({ postal_code: e.target.value })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SOCIAL_PLATFORMS.map((platform) => (
          <Input
            key={platform}
            id={`social_${platform}`}
            label={t(`vendorOnboarding.socials.${platform}`)}
            value={form.socials[platform]}
            dir="ltr"
            onChange={(e) => patch({ socials: { ...form.socials, [platform]: e.target.value } })}
          />
        ))}
      </div>
    </>
  );
}
