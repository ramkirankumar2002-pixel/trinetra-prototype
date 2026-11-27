// Which of this computer's addresses a phone on the same Wi-Fi can reach.
import type { NetworkInterfaceInfo } from "node:os";

export type Interfaces = Record<string, readonly NetworkInterfaceInfo[] | undefined>;

export interface LanAddress {
  name: string;
  address: string;
}

/** Windows names of adapters that no phone can reach. */
const NOT_THE_WIFI =
  /loopback|vethernet|virtualbox|vmware|hyper-v|wsl|docker|bluetooth|tailscale|zerotier|vpn|tap|tun/i;
const WIFI = /wi-?fi|wlan|wireless/i;

const isPrivate = (address: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);

/** The best first: Wi-Fi, then any other real adapter with a private address. */
export function lanAddresses(interfaces: Interfaces): LanAddress[] {
  const found: (LanAddress & { score: number })[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (NOT_THE_WIFI.test(name)) continue;
    for (const { family, address, internal } of entries ?? []) {
      // 169.254.*: the adapter got no address from any network.
      if (family !== "IPv4" || internal || address.startsWith("169.254.")) continue;
      found.push({
        name,
        address,
        score: (WIFI.test(name) ? 2 : 0) + (isPrivate(address) ? 1 : 0),
      });
    }
  }
  return found.sort((a, b) => b.score - a.score).map(({ name, address }) => ({ name, address }));
}
