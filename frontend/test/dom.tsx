/**
 * Small helpers for component tests that run in jsdom (add `// @vitest-environment jsdom` to the
 * test file). They use React's own act() and the DOM, so no extra testing library is needed.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Rendered = { container: HTMLElement; unmount: () => void };

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

export async function render(element: ReactElement): Promise<Rendered> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

/** Unmount everything rendered since the last cleanup. Call from afterEach. */
export function cleanup(): void {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
}

/** Set an input's value the way a user edit does, so React's onChange fires. */
export async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function selectOption(select: HTMLSelectElement, value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
}

/** Focus then blur, which fires React's onBlur. */
export async function blur(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
    element.blur();
  });
}

/** Paste `text` into an element. jsdom has no clipboard, so the event carries a minimal clipboardData. */
export async function paste(element: HTMLElement, text: string): Promise<boolean> {
  const event = Object.assign(new Event("paste", { bubbles: true, cancelable: true }), {
    clipboardData: { getData: () => text },
  });
  await act(async () => {
    element.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

export async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

/** Resolve pending promises (and the state updates they cause) inside act. */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export function byLabel(container: HTMLElement, text: string): HTMLInputElement | HTMLSelectElement {
  const label = [...container.querySelectorAll("label")].find((item) => item.textContent?.replace(/\s*\*$/, "").trim() === text);
  if (!label) throw new Error(`No label "${text}"`);
  const id = label.getAttribute("for");
  const control = id ? container.querySelector<HTMLInputElement | HTMLSelectElement>(`[id="${id}"]`) : null;
  if (!control) throw new Error(`Label "${text}" has no control`);
  return control;
}
