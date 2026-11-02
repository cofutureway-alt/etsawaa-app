import { z } from "zod";
import { normalizeEgyptianPhone } from "~/lib/phone";

/**
 * Auth schemas (Zod) shared between UI forms and server actions —
 * double validation per AGENT.md §15.
 */

const email = z.string().trim().toLowerCase().email();

const phone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const result = normalizeEgyptianPhone(value);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: `phone:${result.reason}` });
      return z.NEVER;
    }
    return result.e164;
  });

export const passwordSchema = z
  .string()
  .min(8)
  .max(72) // bcrypt limit in Supabase Auth
  .regex(/[A-Za-z\u0600-\u06FF]/, "password:needs_letter")
  .regex(/\d/, "password:needs_digit");

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(2).max(60),
    lastName: z.string().trim().min(2).max(60),
    email,
    phone: phone,
    password: passwordSchema,
    confirmPassword: z.string(),
    terms: z.boolean().refine((value) => value === true, { message: "terms:required" }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "password:mismatch",
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value.includes("@")) {
        const parsed = email.safeParse(value);
        if (!parsed.success) {
          ctx.addIssue({ code: "custom", message: "email:invalid" });
          return z.NEVER;
        }
        return { kind: "email" as const, value: parsed.data };
      }
      const result = normalizeEgyptianPhone(value);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: `phone:${result.reason}` });
        return z.NEVER;
      }
      return { kind: "phone" as const, value: result.e164 };
    }),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotSchema = z.object({
  identifier: z
    .string()
    .trim()
    .refine(
      (value) => value.includes("@") || normalizeEgyptianPhone(value).ok,
      "identifier:invalid",
    ),
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "password:mismatch",
  });

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "otp:six_digits");

export const completeGoogleSchema = z.object({
  phone: phone,
  terms: z.boolean().refine((value) => value === true, { message: "terms:required" }),
});

/**
 * 0..4 password strength score for the visible strength meter (US-02).
 * Pure — unit-tested in tests/auth-schemas.test.ts.
 */
export function passwordStrengthScore(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < 8) return 0;
  let score = 1;
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) score += 1;
  if (password.length >= 12) score += 1;
  if (/[^A-Za-z0-9]/.test(password) && password.length >= 10) score += 1;
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
}
