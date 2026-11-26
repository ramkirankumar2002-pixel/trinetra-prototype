// The colours in globals.css: both themes define the same tokens, and text can be read
// on its background (WCAG contrast).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

/** The `--name: #hex` lines of the first block whose selector ends with `selector {`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]),
  );
}

const shared = block("\n:root");
const THEMES = {
  dashboard: { ...shared, ...block(':root,\n[data-theme="dashboard"]') },
  kiosk: { ...shared, ...block('\n[data-theme="kiosk"]') },
};

function luminance(hex: string): number {
  expect(hex, "a solid colour").toMatch(/^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5].map((at) => {
    const part = parseInt(hex.slice(at, at + 2), 16) / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

const STATUSES = ["info", "wait", "go", "stop", "idle"];

/** [text, background]: small text, so at least 4.5 to 1. */
const BOTH: [string, string][] = [
  ["foreground", "background"],
  ["muted-foreground", "background"],
  ["card-foreground", "card-solid"],
  ["muted-foreground", "card-solid"],
  ["popover-foreground", "popover"],
  ["highlight", "card-solid"],
  ["live", "card-solid"],
  ["primary-foreground", "primary"],
  ["primary-foreground", "primary-to"],
  ["go-foreground", "go-to"],
  ["stop-foreground", "stop"],
  ["stop-foreground", "stop-to"],
  ["wait-foreground", "wait"],
  ["info-foreground", "info"],
  ["idle-foreground", "idle"],
  ["nav-foreground", "nav"],
  ["nav-muted", "nav"],
  ["nav-danger", "nav"],
  ["nav-foreground", "nav-active"],
  ...STATUSES.map((name): [string, string] => [`${name}-ink`, `${name}-soft`]),
];

const ONLY: Record<keyof typeof THEMES, [string, string][]> = {
  dashboard: [
    ["go-foreground", "go"],
    ["secondary-foreground", "secondary"],
    ["outline-ink", "card-solid"],
    ["accent-foreground", "accent"],
    ["nav-foreground", "bar"],
    ["nav-muted", "bar-to"],
    ...["blue", "orange", "green", "purple"].map((name): [string, string] => [
      `kpi-${name}-ink`,
      `kpi-${name}`,
    ]),
  ],
  // The kiosk's green button text is 32 px bold, tested against go-to above and here at 3:1.
  kiosk: [["outline-ink", "card-solid"]],
};

describe("themes", () => {
  it("give the kiosk its own value for every colour the dashboard sets", () => {
    const dashboard = Object.keys(block(':root,\n[data-theme="dashboard"]'));
    const kiosk = block('\n[data-theme="kiosk"]');
    // The top bar and KPI circles are only on the dashboard.
    const dashboardOnly = /^(bar|kpi)/;
    expect(dashboard.filter((name) => !dashboardOnly.test(name) && !(name in kiosk))).toEqual([]);
  });

  describe.each(Object.keys(THEMES) as (keyof typeof THEMES)[])("%s", (theme) => {
    const tokens = THEMES[theme];
    it.each([...BOTH, ...ONLY[theme]])("%s on %s can be read", (text, background) => {
      expect(contrast(tokens[text]!, tokens[background]!)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("keeps large button text readable on the lighter end of the kiosk gradients", () => {
    expect(contrast("#ffffff", THEMES.kiosk.go!)).toBeGreaterThanOrEqual(3);
  });

  it("puts the logo on a navy at least as light as the logo's own edge", () => {
    // The logo files have a solid navy background, hidden with mix-blend-lighten.
    expect(shared.nav).toBe("#06182b");
  });
});
