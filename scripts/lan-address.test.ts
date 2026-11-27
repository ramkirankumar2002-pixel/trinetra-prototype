import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { lanAddresses } from "./lan-address";

const ipv4 = (address: string, internal = false) =>
  [{ family: "IPv4", address, internal }] as unknown as NetworkInterfaceInfo[];

describe("lanAddresses", () => {
  it("puts the Wi-Fi first", () => {
    expect(lanAddresses({ Ethernet: ipv4("192.168.1.9"), "Wi-Fi": ipv4("10.4.55.108") })).toEqual([
      { name: "Wi-Fi", address: "10.4.55.108" },
      { name: "Ethernet", address: "192.168.1.9" },
    ]);
  });

  it("leaves out adapters a phone cannot reach", () => {
    expect(
      lanAddresses({
        "Loopback Pseudo-Interface 1": ipv4("127.0.0.1", true),
        "vEthernet (WSL)": ipv4("172.20.0.1"),
        "VirtualBox Host-Only Network": ipv4("192.168.56.1"),
        "Bluetooth Network Connection": ipv4("192.168.44.1"),
        "Ethernet 2": ipv4("169.254.10.10"),
      }),
    ).toEqual([]);
  });

  it("takes the laptop's own hotspot when that is all there is", () => {
    expect(lanAddresses({ "Local Area Connection* 2": ipv4("192.168.137.1") })).toHaveLength(1);
  });
});
