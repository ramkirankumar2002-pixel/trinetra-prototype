// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MENUS } from "@/lib/menus";
import { DashboardShell } from "../layout/dashboard-shell";
import { StatusPill } from "../ui/status-pill";
import { TONES } from "../ui/tone";
import { DataTable } from "./data-table";

afterEach(cleanup);

describe("DataTable", () => {
  const rows = [{ ticket: "SAMPLE-1" }, { ticket: "SAMPLE-2" }];
  const show = () =>
    render(
      <DataTable
        label="Trucks"
        rows={rows}
        rowKey={(row) => row.ticket}
        columns={[
          { id: "ticket", header: "Ticket", cell: (row) => row.ticket },
          { id: "go", header: "Action", actions: true, cell: () => <button>Verify</button> },
        ]}
      />,
    );

  it("is one table, with each value and button in the page only once", () => {
    show();
    const table = screen.getByRole("table", { name: "Trucks" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getAllByText("SAMPLE-1")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Verify" })).toHaveLength(2);
  });

  it("labels the values on a card, but not the buttons", () => {
    show();
    const [first, actions] = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(first!.textContent).toBe("TicketSAMPLE-1");
    expect(actions!.textContent).toBe("Verify");
  });
});

describe("StatusPill", () => {
  it.each(TONES)("shows an icon and its words (%s)", (tone) => {
    const { container } = render(<StatusPill tone={tone}>Words</StatusPill>);
    expect(container.textContent).toBe("Words");
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("DashboardShell", () => {
  const show = () =>
    render(
      <DashboardShell
        title="Supervisor"
        menu={MENUS.supervisor}
        active="/supervisor/trucks"
        user={{ name: "Sample", role: "Supervisor", profileHref: "/supervisor/profile" }}
        alerts={{ count: 3, href: "/supervisor#alerts" }}
        logout={<button>Log out</button>}
      >
        page
      </DashboardShell>,
    );

  it("marks the page being shown, in the sidebar and in the phone's tabs", () => {
    show();
    for (const name of ["Menu", "Main pages"]) {
      const links = within(screen.getByRole("navigation", { name })).getAllByRole("link");
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        "/supervisor",
        "/supervisor/trucks",
        "/supervisor/done",
        "/supervisor/profile",
      ]);
      const current = links.filter((link) => link.getAttribute("aria-current") === "page");
      expect(current.map((link) => link.getAttribute("href"))).toEqual(["/supervisor/trucks"]);
    }
  });

  it("says how many alerts there are", () => {
    show();
    expect(screen.getByRole("link", { name: "Alerts: 3" })).toBeTruthy();
  });

  it("opens the drawer with the menu and Logout, and closes it", async () => {
    show();
    // Both menu buttons are in the page; the styles show one of them at a time.
    const [drawerButton] = screen.getAllByRole("button", { name: /^(Open|Close) menu$/ });
    await userEvent.click(drawerButton!);
    const drawer = screen.getByRole("dialog", { name: "Menu" });
    expect(within(drawer).getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(within(drawer).getAllByRole("link")).toHaveLength(4);

    await userEvent.click(within(drawer).getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
