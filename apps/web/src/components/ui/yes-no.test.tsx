// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YesNo } from "./yes-no";

afterEach(cleanup);

function show(disabled = false) {
  const onYes = vi.fn();
  const onNo = vi.fn();
  render(<YesNo yesLabel="Yes" noLabel="No" onYes={onYes} onNo={onNo} disabled={disabled} />);
  return { onYes, onNo };
}

describe("YesNo", () => {
  it("has Yes first (left) in green and No second (right) in red", () => {
    show();
    const [yes, no] = screen.getAllByRole("button");
    expect(yes!.textContent).toBe("Yes");
    expect(yes!.dataset.variant).toBe("go");
    expect(no!.textContent).toBe("No");
    expect(no!.dataset.variant).toBe("stop");
  });

  it("shows an icon and a word on each button", () => {
    show();
    for (const button of screen.getAllByRole("button")) {
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("calls only the answer that was pressed", async () => {
    const { onYes, onNo } = show();
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(onNo).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onNo).toHaveBeenCalledTimes(1);
  });

  it("answers nothing while disabled", async () => {
    const { onYes, onNo } = show(true);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onYes).not.toHaveBeenCalled();
    expect(onNo).not.toHaveBeenCalled();
  });
});
