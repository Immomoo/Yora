export function comparableAddress(address?: string): string {
  if (!address) return "";
  const lower = address.trim().toLowerCase();
  const hex = lower.startsWith("0x") ? lower.slice(2) : lower;
  const stripped = hex.replace(/^0+/, "");
  return `0x${stripped || "0"}`;
}

export function addressSlug(address?: string): string {
  return comparableAddress(address).slice(2);
}

export function sameAddress(left?: string, right?: string): boolean {
  return Boolean(left && right) && comparableAddress(left) === comparableAddress(right);
}
