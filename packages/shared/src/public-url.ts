// The address other devices use to open the website: what goes into the QR codes.

const LOCAL_HOSTS = new Set(["localhost", "0.0.0.0", "[::1]", "[::]"]);

/** True for an address that only means "this computer": a phone cannot open it. */
export function isLocalOnlyUrl(url: string): boolean {
  const host = URL.parse(url)?.hostname.toLowerCase();
  if (!host) return false;
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost") || /^127\./.test(host);
}
