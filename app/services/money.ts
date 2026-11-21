export function currencyDecimals(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid currency");
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
export function amountToMinor(value: string, currency: string): bigint {
  const decimals = currencyDecimals(currency);
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(value))
    throw new Error("Enter a non-negative currency amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`Use at most ${decimals} decimal places for ${currency}`);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  );
}
export function formatMinor(value: bigint | string, currency: string) {
  const amount = BigInt(value);
  const decimals = currencyDecimals(currency);
  const scale = 10n ** BigInt(decimals);
  const abs = amount < 0n ? -amount : amount;
  return `${currency} ${amount < 0n ? "-" : ""}${abs / scale}${decimals ? `.${(abs % scale).toString().padStart(decimals, "0")}` : ""}`;
}
