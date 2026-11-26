// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NumberPad } from "./number-pad";

afterEach(cleanup);

const labels = { pad: "Number pad", clear: "Clear", backspace: "Delete" };

function Pad({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <>
      <output>{value}</output>
      <input aria-label="name" />
      <NumberPad
        value={value}
        onChange={setValue}
        maxLength={6}
        labels={labels}
        disabled={disabled}
      />
    </>
  );
}

const typed = () => screen.getByRole("status").textContent;
const press = async (...names: string[]) => {
  for (const name of names) await userEvent.click(screen.getByRole("button", { name }));
};

describe("NumberPad", () => {
  it("has the ten digits, Clear and Delete", () => {
    render(<Pad />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      ..."123456789",
      "Clear",
      "0",
      "Delete",
    ]);
  });

  it("types digits, deletes one and clears all", async () => {
    render(<Pad />);
    await press("1", "0", "0", "1");
    expect(typed()).toBe("1001");
    await press("Delete");
    expect(typed()).toBe("100");
    await press("Clear");
    expect(typed()).toBe("");
  });

  it("stops at the longest length", async () => {
    render(<Pad />);
    await press("1", "2", "3", "4", "5", "6");
    expect(screen.getByRole("button", { name: "7" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(window, { key: "7" });
    expect(typed()).toBe("123456");
  });

  it("takes digits and Backspace from a keyboard", () => {
    render(<Pad />);
    for (const key of ["3", "0", "x", "1", "Backspace"]) fireEvent.keyDown(window, { key });
    expect(typed()).toBe("30");
  });

  it("leaves typing in a text box alone", () => {
    render(<Pad />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "5" });
    expect(typed()).toBe("");
  });

  it("does nothing while disabled", async () => {
    render(<Pad disabled />);
    await press("1");
    fireEvent.keyDown(window, { key: "2" });
    expect(typed()).toBe("");
  });
});
