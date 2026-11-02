import { z } from "zod";
import { normalizeEgyptianPhone } from "~/lib/phone";

/**
 * Onboarding wizard schemas (Zod) shared between the 5-step form, the autosave
 * action and `fn_vendor_onboard` — double validation per AGENT.md §15.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v);

export const onboardingStoreSchema = z.object({
  store_name_ar: z.string().trim().min(2, "name_min").max(120),
  store_name_en: z.string().trim().min(2, "name_min").max(120),
  short_desc_ar: optionalText(280),
  short_desc_en: optionalText(280),
  welcome_msg_ar: optionalText(280),
  welcome_msg_en: optionalText(280),
  slug: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-zA-Z0-9\u0600-\u06FF-]*$/, "slug_charset")
    .optional()
    .default(""),
  logo_path: z.string().trim().optional().default(""),
  banner_path: z.string().trim().optional().default(""),
  category_ids: z.array(z.string().uuid()).min(1, "category_required").max(10),
});
export type OnboardingStoreInput = z.infer<typeof onboardingStoreSchema>;

export const onboardingDetailsSchema = z.object({
  first_name: z.string().trim().min(2, "name_min").max(60),
  last_name: z.string().trim().min(2, "name_min").max(60),
  phone: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return "";
      const result = normalizeEgyptianPhone(value);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: `phone:${result.reason}` });
        return z.NEVER;
      }
      return result.e164;
    }),
  governorate_id: z.number().int().positive("area_required"),
  area_id: z.number().int().positive("area_required"),
  address1: z.string().trim().min(3, "address_min").max(200),
  address2: optionalText(200),
  postal_code: optionalText(20),
  socials: z
    .object({
      facebook: optionalText(200),
      instagram: optionalText(200),
      x: optionalText(200),
      tiktok: optionalText(200),
      whatsapp: optionalText(200),
    })
    .optional()
    .default({ facebook: "", instagram: "", x: "", tiktok: "", whatsapp: "" }),
});
export type OnboardingDetailsInput = z.infer<typeof onboardingDetailsSchema>;

export const onboardingTermsSchema = z.object({
  terms_accepted: z.boolean().refine((v) => v === true, { message: "terms:required" }),
  terms_signature: z.string().trim().min(4, "signature_min").max(120),
});
export type OnboardingTermsInput = z.infer<typeof onboardingTermsSchema>;

/** The exact payload shape `fn_vendor_onboard` validates server-side. */
export const onboardingSubmitSchema = onboardingStoreSchema
  .merge(onboardingDetailsSchema)
  .extend({
    terms_version: z.string().min(1),
    terms_signature: z.string().trim().min(4, "signature_min").max(120),
  });
export type OnboardingSubmitInput = z.infer<typeof onboardingSubmitSchema>;

/** One wizard step autosave: { step, ...fields } — partial by design. */
export const onboardingAutosaveSchema = z.object({
  step: z.number().int().min(1).max(5),
  data: z.record(z.string(), z.unknown()),
});
export type OnboardingAutosaveInput = z.infer<typeof onboardingAutosaveSchema>;

export const SOCIAL_PLATFORMS = ["facebook", "instagram", "x", "tiktok", "whatsapp"] as const;
