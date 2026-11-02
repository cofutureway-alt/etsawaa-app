import { z } from "zod";

/**
 * Product wizard schemas (Zod) shared between the 5-step form, autosave and
 * `fn_save_product` — double validation per AGENT.md §15. Money is integer
 * piastres (AGENT §7); sale must be lower than price.
 */

export const piastres = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({ code: "custom", message: "price:invalid" });
      return z.NEVER;
    }
    return Math.round(n * 100);
  });

export const optionalPiastres = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === "" || value === null) return null;
    const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  });

export const productBasicsSchema = z.object({
  name_ar: z.string().trim().min(2, "name_min").max(200),
  name_en: z.string().trim().min(2, "name_min").max(200),
  desc_ar: z.string().trim().max(20000).optional().default(""),
  desc_en: z.string().trim().max(20000).optional().default(""),
  short_ar: z.string().trim().max(300).optional().default(""),
  short_en: z.string().trim().max(300).optional().default(""),
});
export type ProductBasicsInput = z.infer<typeof productBasicsSchema>;

export const productClassificationSchema = z.object({
  leaf_category_id: z.string().uuid("category_required"),
  brand_id: z.string().uuid().optional().or(z.literal("")),
  tag_ids: z.array(z.string().uuid()).max(20).optional().default([]),
  media: z
    .array(
      z.object({
        kind: z.enum(["image", "video"]),
        path: z.string().min(1),
      }),
    )
    .min(1, "media_required")
    .max(12),
  is_fragile: z.boolean().optional().default(false),
});
export type ProductClassificationInput = z.infer<typeof productClassificationSchema>;

export const productPricingSchema = z
  .object({
    price: piastres,
    sale_price: optionalPiastres,
    sale_starts_at: z.string().optional().default(""),
    sale_ends_at: z.string().optional().default(""),
  })
  .refine((d) => d.sale_price === null || d.sale_price < d.price, {
    path: ["sale_price"],
    message: "sale:must_be_lower",
  })
  .refine(
    (d) =>
      !d.sale_starts_at ||
      !d.sale_ends_at ||
      new Date(d.sale_ends_at).getTime() > new Date(d.sale_starts_at).getTime(),
    { path: ["sale_ends_at"], message: "sale_schedule:invalid" },
  );
export type ProductPricingInput = z.infer<typeof productPricingSchema>;

export const productShippingSchema = z.object({
  weight_g: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "" || v === null) return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, ""));
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    }),
  dims: z
    .object({
      l_cm: z.number().nonnegative().nullable().optional().default(null),
      w_cm: z.number().nonnegative().nullable().optional().default(null),
      h_cm: z.number().nonnegative().nullable().optional().default(null),
    })
    .optional()
    .default({ l_cm: null, w_cm: null, h_cm: null }),
  shipping_class: z.enum(["standard", "heavy", "fragile"]).optional().default("standard"),
  shipping_mode: z.enum(["platform", "vendor"]).optional().default("platform"),
});
export type ProductShippingInput = z.infer<typeof productShippingSchema>;

/** Variant row as edited in the matrix (client-side values before fn_save_variants). */
export const variantRowSchema = z.object({
  id: z.string().uuid().optional(),
  option_key: z.string(),
  sku: z.string().trim().min(1, "sku_required").max(60),
  price: piastres,
  sale_price: optionalPiastres,
  stock: z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d]/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: "custom", message: "stock:invalid" });
        return z.NEVER;
      }
      return Math.round(n);
    }),
  image_path: z.string().optional().default(""),
  is_active: z.boolean().optional().default(true),
});
export type VariantRowInput = z.infer<typeof variantRowSchema>;

/** Wizard autosave payload for `fn_save_product`. */
export const productSaveSchema = z.object({
  ...productBasicsSchema.shape,
  ...productClassificationSchema.partial().shape,
  leaf_category_id: z.string().uuid().optional(), // optional while drafting
  media: z.array(z.object({ kind: z.enum(["image", "video"]), path: z.string() })).optional(),
  sale_starts_at: z.string().optional(),
  sale_ends_at: z.string().optional(),
  default_price_piastres: z.number().int().positive().optional(),
  default_sale_piastres: z.number().int().positive().optional(),
  apply_defaults: z.boolean().optional(),
  attributes: z
    .array(
      z.object({
        attribute_id: z.string().uuid(),
        option_id: z.string().uuid().optional().or(z.literal("")),
        value_text: z.string().optional().or(z.literal("")),
        value_number: z.union([z.string(), z.number()]).optional().or(z.literal("")),
        value_bool: z.boolean().optional(),
      }),
    )
    .optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
  ...productShippingSchema.partial().shape,
  weight_g: z.number().int().nonnegative().nullable().optional(),
});
export type ProductSaveInput = z.infer<typeof productSaveSchema>;
