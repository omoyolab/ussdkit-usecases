// Turning what people type into values the wallet can use.

/** Kenyan mobile numbers in any of the ways people write them, to +2547XXXXXXXX. */
export function parsePhone(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  const match = /^(?:\+?254|0)([17]\d{8})$/.exec(digits);
  return match ? `+254${match[1]}` : null;
}

/** +254712345678 as people say it: 0712345678. */
export function local(phone: string): string {
  return phone.startsWith("+254") ? `0${phone.slice(4)}` : phone;
}

/** Whole shillings. Accepts "1500" and "1,500". Rejects decimals, words and anything out of range. */
export function parseAmount(input: string, min: number, max: number): number | null {
  const cleaned = input.replace(/,/g, "");
  if (!/^\d{1,7}$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return amount >= min && amount <= max ? amount : null;
}

export function kes(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE")}`;
}
