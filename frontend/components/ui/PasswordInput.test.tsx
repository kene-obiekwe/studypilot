// @vitest-environment jsdom
import axe from "axe-core";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { byLabel, cleanup, click, render, typeInto } from "@/test/dom";

import { Field } from "./Field";
import { PasswordInput } from "./PasswordInput";

afterEach(cleanup);

const toggle = (container: HTMLElement) => container.querySelector("button") as HTMLButtonElement;
const field = (container: HTMLElement) => container.querySelector("input") as HTMLInputElement;

/** A real mouse or touch click has detail >= 1; element.click() (and Enter or Space) has 0. */
async function mouseClick(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1 }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

function Labelled(props: Partial<React.ComponentProps<typeof PasswordInput>> = {}) {
  return (
    <Field label="Password" required>
      <PasswordInput name="password" autoComplete="current-password" {...props} />
    </Field>
  );
}

describe("PasswordInput", () => {
  it("starts hidden, with a labelled, unpressed toggle that is not a submit button", async () => {
    const { container } = await render(<Labelled />);
    expect(field(container).type).toBe("password");
    const button = toggle(container);
    expect(button.getAttribute("aria-label")).toBe("Show password");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.type).toBe("button");
  });

  it("shows and hides the password, updating its label and pressed state", async () => {
    const { container } = await render(<Labelled />);
    await typeInto(field(container), "hunter2-hunter2");

    await click(toggle(container));
    expect(field(container).type).toBe("text");
    expect(field(container).value).toBe("hunter2-hunter2");
    expect(toggle(container).getAttribute("aria-label")).toBe("Hide password");
    expect(toggle(container).getAttribute("aria-pressed")).toBe("true");

    await click(toggle(container));
    expect(field(container).type).toBe("password");
    expect(toggle(container).getAttribute("aria-label")).toBe("Show password");
    expect(toggle(container).getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the autocomplete hint and the other attributes, hidden or shown", async () => {
    const { container } = await render(<Labelled autoComplete="new-password" minLength={8} />);
    for (let round = 0; round < 2; round++) {
      expect(field(container).getAttribute("autocomplete")).toBe("new-password");
      expect(field(container).minLength).toBe(8);
      expect(field(container).name).toBe("password");
      await click(toggle(container));
    }
  });

  it("stays labelled by its Field", async () => {
    const { container } = await render(<Labelled />);
    expect(byLabel(container, "Password")).toBe(field(container));
  });

  it("a mouse press does not take focus from the field, and a click puts focus in it", async () => {
    const { container } = await render(<Labelled />);
    field(container).focus();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1 });
    await act(async () => {
      toggle(container).dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);

    document.body.focus();
    await mouseClick(toggle(container));
    expect(document.activeElement).toBe(field(container));
    expect(field(container).type).toBe("text");
  });

  it("pressing the toggle from the keyboard leaves focus on the toggle", async () => {
    const { container } = await render(<Labelled />);
    toggle(container).focus();
    await click(toggle(container)); // detail 0, as Enter and Space produce
    expect(document.activeElement).toBe(toggle(container));
    expect(field(container).type).toBe("text");
  });

  it("can be controlled, so a page can hide the password again", async () => {
    const seen: boolean[] = [];
    function Page() {
      const [revealed, setRevealed] = useState(false);
      return (
        <>
          <Labelled
            revealed={revealed}
            onRevealedChange={(next) => {
              seen.push(next);
              setRevealed(next);
            }}
          />
          <button type="button" id="after-submit" onClick={() => setRevealed(false)}>
            after a successful submit
          </button>
        </>
      );
    }
    const { container } = await render(<Page />);
    await click(toggle(container));
    expect(field(container).type).toBe("text");
    expect(seen).toEqual([true]);

    await click(container.querySelector("#after-submit") as HTMLElement);
    expect(field(container).type).toBe("password");
    expect(toggle(container).getAttribute("aria-label")).toBe("Show password");
  });

  it("forwards its ref to the input", async () => {
    const ref = vi.fn();
    await render(
      <Field label="Password">
        <PasswordInput ref={ref} />
      </Field>,
    );
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLInputElement));
  });

  it("passes axe, hidden and shown", async () => {
    const { container } = await render(<Labelled />);
    const scan = async () =>
      (await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => v.id);
    expect(await scan()).toEqual([]);
    await click(toggle(container));
    expect(await scan()).toEqual([]);
  });
});
