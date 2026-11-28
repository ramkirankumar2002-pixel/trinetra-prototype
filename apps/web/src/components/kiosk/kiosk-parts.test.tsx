// @vitest-environment jsdom
// The question screen's tiles, the plate keypad, the weighing ring and the slips.
import type { ApprovalView, TicketView } from "@trinetra/shared";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Box, Truck } from "lucide-react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLanguageStore } from "@/i18n/language-store";
import { translate, type Translate } from "@/i18n/translate";
import { LetterKeypad, PlateKeypad } from "./keypads";
import { materialLabel } from "./material-look";
import { approvalsText, slipFields, timeIST, wasPrinted } from "./slip-fields";
import { PrintSlip, SlipView } from "./slip";
import { ChoiceTiles } from "./tiles";
import { RING_MS, WeighingRing } from "./weighing";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const t: Translate = (key, params) => translate("en", key, params);

describe("the question screen's tiles", () => {
  const choices = [
    { value: "Sand", label: "Sand", icon: Box },
    { value: "Bricks", label: "Bricks", icon: Truck },
  ];

  it("shows one big button per answer, each with a picture and a word", async () => {
    const onPick = vi.fn();
    render(<ChoiceTiles label="Material" choices={choices} onPick={onPick} />);
    const buttons = within(screen.getByRole("group", { name: "Material" })).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Sand", "Bricks"]);
    for (const button of buttons) {
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(button.className).toContain("min-h-24");
    }
    await userEvent.click(screen.getByRole("button", { name: "Bricks" }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("Bricks");
  });

  it("says why it asks again, and marks the saved answer", () => {
    render(
      <ChoiceTiles
        label="Material"
        choices={choices}
        selected="Sand"
        message={{ tone: "stop", text: "This does not match your invoice." }}
        onPick={() => {}}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("This does not match your invoice.");
    expect(screen.getByRole("button", { name: "Sand" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Bricks" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("takes no answer while one is being saved", async () => {
    const onPick = vi.fn();
    render(<ChoiceTiles label="Material" choices={choices} disabled onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "Sand" }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("translates material names, and keeps a name it does not know", () => {
    const hindi: Translate = (key, params) => translate("hi", key, params);
    expect(materialLabel(hindi, "Sand")).toBe("रेत");
    expect(materialLabel(hindi, "Fly Ash")).toBe("Fly Ash");
  });
});

describe("the plate keypad", () => {
  function Keypad() {
    const [value, setValue] = useState("");
    return (
      <>
        <PlateKeypad
          value={value}
          onChange={setValue}
          labels={{ pad: "Plate keypad", typed: "Plate", backspace: "Delete" }}
        />
        <p data-testid="raw">{value}</p>
      </>
    );
  }
  const type = async (text: string) => {
    const pad = screen.getByRole("group", { name: "Plate keypad" });
    for (const key of text) {
      await userEvent.click(within(pad).getByRole("button", { name: key }));
    }
  };

  it("has every digit and letter, and nothing else", () => {
    render(<Keypad />);
    const keys = within(screen.getByRole("group", { name: "Plate keypad" })).getAllByRole("button");
    expect(keys.map((key) => key.textContent).join("")).toBe(
      "1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    );
  });

  it("types a plate, shows it spaced once it is whole, and deletes", async () => {
    render(<Keypad />);
    await type("MH12AB1234");
    expect(screen.getByRole("status", { name: "Plate" }).textContent).toBe("MH 12 AB 1234");
    // Kept as the backend stores it.
    expect(screen.getByTestId("raw").textContent).toBe("MH12AB1234");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByTestId("raw").textContent).toBe("MH12AB123");
  });

  it("stops at the longest plate", async () => {
    render(<Keypad />);
    await type("MH12ABC1234");
    expect(screen.getByRole("button", { name: "A" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("the letter keypad", () => {
  function Keypad() {
    const [value, setValue] = useState("");
    return (
      <LetterKeypad
        value={value}
        onChange={setValue}
        labels={{
          pad: "Letters",
          typed: "Name",
          space: "Space",
          backspace: "Delete",
          placeholder: "Your name",
        }}
      />
    );
  }

  it("starts each word with a capital, and allows one space at a time", async () => {
    render(<Keypad />);
    const press = (name: string) => userEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name: "Space" }).hasAttribute("disabled")).toBe(true);
    for (const key of ["R", "A", "M"]) await press(key);
    await press("Space");
    expect(screen.getByRole("button", { name: "Space" }).hasAttribute("disabled")).toBe(true);
    for (const key of ["L", "A", "L"]) await press(key);
    expect(screen.getByRole("status", { name: "Name" }).textContent).toBe("Ram Lal");
  });
});

describe("the weighing ring", () => {
  const ring = () => screen.getByTestId("ring").dataset.state;

  function setup(canCapture: boolean) {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    const view = render(
      <WeighingRing canCapture={canCapture} settled={false} onSettled={onSettled} text="x" />,
    );
    const set = (can: boolean, settled = false) =>
      view.rerender(
        <WeighingRing canCapture={can} settled={settled} onSettled={onSettled} text="x" />,
      );
    const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
    return { onSettled, set, wait };
  }

  it("fills over 3 seconds while a weight can be taken", () => {
    const { onSettled, set, wait } = setup(true);
    expect(RING_MS).toBe(3000);
    expect(ring()).toBe("filling");
    wait(2999);
    expect(onSettled).not.toHaveBeenCalled();
    wait(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    set(true, true);
    expect(ring()).toBe("full");
  });

  it("starts again from nothing when the weight moves", () => {
    const { onSettled, set, wait } = setup(true);
    wait(2000);
    set(false);
    expect(ring()).toBe("empty");
    wait(10_000);
    expect(onSettled).not.toHaveBeenCalled();
    set(true);
    wait(2999);
    expect(onSettled).not.toHaveBeenCalled();
    wait(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("does not fill while no weight can be taken", () => {
    const { onSettled, wait } = setup(false);
    wait(10_000);
    expect(ring()).toBe("empty");
    expect(onSettled).not.toHaveBeenCalled();
  });
});

// ---- The slips ----

const approval = (values: Partial<ApprovalView>): ApprovalView => ({
  id: 1,
  kind: "SUPERVISOR",
  status: "APPROVED",
  plateWarningReason: null,
  reason: null,
  chosenWeight: null,
  chosenMaterial: null,
  decidedBy: "Amit Kumar",
  plateRead: null,
  matchResult: null,
  plateConfidence: null,
  captureSource: null,
  manualPlate: null,
  plateMatch: true,
  photoId: null,
  gps: null,
  createdAt: "2026-11-27T08:00:00.000Z",
  decidedAt: "2026-11-27T08:32:00.000Z",
  ...values,
});

const ticket: TicketView = {
  publicToken: "0123456789abcdef0123456789abcdef",
  id: 7,
  ticketNo: "WB01-20261127-0007",
  plate: "MH12AB1234",
  status: "COMPLETED",
  type: "TYPE_1",
  language: "en",
  load: "LOADED",
  noInvoice: false,
  material: "Cement Bags",
  supplier: "Sample Cement Depot",
  transporter: "Sri Balaji Transport",
  invoice: {
    number: "SMPL-CEM-001",
    material: "Cement Bags",
    date: "2026-11-26",
    weightKg: 14_310,
    state: "read",
    error: null,
  },
  heldWeightKg: null,
  firstWeightKg: 32_560,
  secondWeightKg: 18_250,
  netKg: 14_310,
  variancePct: 0,
  finalWeightKg: 14_310,
  tripNo: 1,
  unloadingPoint: { code: "Plant", name: "Plant" },
  supervisor: { id: 1, name: "Amit Kumar", phone: "9876543210" },
  driverName: "Ravi",
  driverPhone: "9000000001",
  mismatchAttempts: 0,
  isDemo: false,
  plateCheck: "NOT_NEEDED",
  holdReason: null,
  warnings: [],
  createdAt: "2026-11-27T08:00:00.000Z",
  // 13:30 and 14:10 in India.
  firstWeightAt: "2026-11-27T08:00:00.000Z",
  secondWeightAt: "2026-11-27T08:40:00.000Z",
  closedAt: "2026-11-27T08:40:00.000Z",
  approvals: [approval({})],
  photos: [],
  timeline: [],
};

const values = (slip: "FIRST" | "FINAL", of: TicketView = ticket) =>
  Object.fromEntries(slipFields(of, slip, t).map((field) => [field.label, field.value]));

describe("what the slips say", () => {
  it("shows times in India", () => {
    expect(timeIST("2026-11-27T08:00:00.000Z")).toBe("13:30");
  });

  it("first slip: truck, material, invoice, first weight and where to go", () => {
    expect(values("FIRST")).toMatchObject({
      "slip.plate": "MH 12 AB 1234",
      "slip.firstWeight": "32,560 kg · 13:30",
      "slip.material": "Cement Bags · Type 1",
      "slip.supplier": "Sample Cement Depot",
      "slip.transporter": "Sri Balaji Transport",
      "slip.invoiceNo": "SMPL-CEM-001",
      "slip.invoiceWeight": "14,310 kg",
      "slip.driverPhone": "9000000001",
      "slip.goTo": "Plant",
      "slip.supervisor": "Amit Kumar",
      "slip.supervisorPhone": "9876543210",
    });
  });

  it("final slip: both weights with times, net, variance, PASS and who approved", () => {
    expect(values("FINAL")).toMatchObject({
      "slip.firstShort": "32,560 kg · 13:30",
      "slip.secondShort": "18,250 kg · 14:10",
      "slip.netWeight": "14,310 kg",
      "slip.invoiceWeight": "14,310 kg",
      "slip.variance": "0%",
      "slip.result": "PASS",
      "slip.unloadedAt": "Plant",
      "slip.approvedBy": "Amit Kumar · 14:02",
    });
    // The driver's phone number is not on the final slip.
    expect(values("FINAL")).not.toHaveProperty("slip.driverPhone");
  });

  it("a hold approved by the store shows the chosen weight instead of PASS", () => {
    const held: TicketView = {
      ...ticket,
      variancePct: 1.31,
      finalWeightKg: 14_500,
      approvals: [
        approval({ id: 1, kind: "STORE_TYPE2", decidedBy: "Ram" }),
        approval({
          id: 2,
          kind: "HOLD",
          decidedBy: "Ram",
          chosenWeight: "INVOICE_WEIGHT",
          decidedAt: "2026-11-27T08:45:00.000Z",
        }),
      ],
    };
    const shown = values("FINAL", held);
    expect(shown["slip.acceptedInvoice"]).toBe("14,500 kg");
    expect(shown).not.toHaveProperty("slip.result");
    // One person, both times.
    expect(shown["slip.approvedBy"]).toBe("Ram · 14:02, 14:15");
  });

  it("marks a manual check, and leaves warnings and help calls out", () => {
    const text = approvalsText(
      {
        ...ticket,
        approvals: [
          approval({ plateMatch: false }),
          approval({ id: 2, kind: "DRIVER_HELP", decidedBy: "Ram" }),
          approval({
            id: 3,
            kind: "PLATE_WARNING",
            plateWarningReason: "FRONT_BACK_MISMATCH",
            decidedBy: "Ram",
          }),
        ],
      },
      t,
    );
    expect(text).toBe("Amit Kumar · 14:02 (manual check)");
  });

  it("knows when a slip has been printed before, each slip on its own", () => {
    const printed: TicketView = {
      ...ticket,
      timeline: [
        {
          type: "SLIP_PRINTED",
          at: ticket.createdAt,
          actor: "user:1",
          actorName: "WB-01",
          data: { kind: "FIRST" },
        },
      ],
    };
    expect(wasPrinted(ticket, "FIRST")).toBe(false);
    expect(wasPrinted(printed, "FIRST")).toBe(true);
    expect(wasPrinted(printed, "FINAL")).toBe(false);
  });
});

describe("the slip on screen", () => {
  it("has the ticket number, the weights, the result and the QR code", async () => {
    render(<SlipView ticket={ticket} slip="FINAL" reprint={false} />);
    const slip = screen.getByRole("region", { name: "Final slip" });
    expect(slip.textContent).toContain("WB01-20261127-0007");
    expect(slip.textContent).toContain("27 Nov 2026, 14:10 IST");
    expect(slip.textContent).toContain("14,310 kg");
    expect(slip.textContent).toContain("PASS");
    expect(slip.textContent).not.toContain("Reprint");
    const qr = await screen.findByRole("img", { name: "QR code of this ticket" });
    expect(qr.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  });

  it("is marked when it is a reprint", () => {
    render(<SlipView ticket={ticket} slip="FIRST" reprint />);
    expect(screen.getByRole("region", { name: "First slip" }).textContent).toContain("Reprint");
  });
});

describe("the printed slip", () => {
  const rows = () =>
    [...screen.getByTestId("print-slip").querySelectorAll("tr")].map((row) => [
      row.querySelector("th")!.textContent,
      row.querySelector("td")!.textContent,
    ]);

  it("says PASS once, and marks a reprint", () => {
    render(<PrintSlip ticket={ticket} slip="FINAL" reprint />);
    expect(rows().filter(([, value]) => value === "PASS")).toEqual([["Result", "PASS"]]);
    expect(screen.getByTestId("print-slip").textContent).toContain("Reprint");
    // Everything section 12 asks for, also what the screen shows in its heading.
    expect(rows().map(([label]) => label)).toEqual(
      expect.arrayContaining(["Vehicle", "Unload at", "Supervisor", "Approved by"]),
    );
  });

  it("labels each line in English and the driver's language", () => {
    // Outside the kiosk pages, the staff language is the one in use.
    useLanguageStore.getState().setLanguage("staff", "hi");
    try {
      render(<PrintSlip ticket={ticket} slip="FIRST" reprint={false} />);
      expect(rows().map(([label]) => label)).toContain("First weight / पहला वज़न");
    } finally {
      useLanguageStore.getState().setLanguage("staff", "en");
    }
  });
});
