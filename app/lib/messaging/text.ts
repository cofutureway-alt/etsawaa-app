/**
 * SMS / WhatsApp text helpers. Pure — covered by tests/messaging.test.ts.
 */

/** Fill {{variables}}; unknown ones become empty, line breaks are kept. */
export function renderText(template: string, variables: Record<string, string>): string {
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => (variables[name] ?? "").replace(/\r/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Characters outside GSM-7 force the 70-per-part (UCS-2) count — Arabic always does. */
const GSM7 = /^[\n\r @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;

export interface SmsSize { chars: number; parts: number; perPart: number; unicode: boolean }

/** How many SMS parts a text costs (Rasvio: 160 Latin or 70 Arabic per part). */
export function smsSize(text: string): SmsSize {
  const unicode = !GSM7.test(text);
  const chars = [...text].length;
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const parts = chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / multi);
  return { chars, parts, perPart: chars <= single ? single : multi, unicode };
}

/** Variables a text uses that the event does not offer. */
export function unknownVariables(text: string, allowed: string[]): string[] {
  const used = [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set(used.filter((v) => !allowed.includes(v)))];
}

/** "+201012345678" → "+20 101 ••• 5678" for logs and screens. */
export function maskNumber(e164: string): string {
  if (!/^\+\d{10,15}$/.test(e164)) return e164;
  return `${e164.slice(0, 3)} ${e164.slice(3, 6)} ••• ${e164.slice(-4)}`;
}
