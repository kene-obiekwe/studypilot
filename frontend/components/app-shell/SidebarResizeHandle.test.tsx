// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@/lib/sidebar";
import { cleanup, render } from "@/test/dom";

import { SidebarResizeHandle } from "./SidebarResizeHandle";

afterEach(() => {
  cleanup();
});

async function setup(width = 248) {
  const onResize = vi.fn();
  const onCommit = vi.fn();
  const onDraggingChange = vi.fn();
  const { container } = await render(
    <SidebarResizeHandle
      width={width}
      controls="app-sidebar"
      onResize={onResize}
      onCommit={onCommit}
      onDraggingChange={onDraggingChange}
    />,
  );
  const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
  return { handle, onResize, onCommit, onDraggingChange };
}

async function key(element: HTMLElement, name: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });
}

async function pointer(element: HTMLElement, type: string, clientX: number) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 }));
  });
}

describe("SidebarResizeHandle", () => {
  it("is a focusable vertical separator that reports its width and range", async () => {
    const { handle } = await setup(280);
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-label")).toBe("Resize sidebar");
    expect(handle.getAttribute("aria-controls")).toBe("app-sidebar");
    expect(handle.getAttribute("aria-valuenow")).toBe("280");
    expect(handle.getAttribute("aria-valuemin")).toBe(String(SIDEBAR_MIN_WIDTH));
    expect(handle.getAttribute("aria-valuemax")).toBe(String(SIDEBAR_MAX_WIDTH));
    expect(handle.tabIndex).toBe(0);
  });

  it("steps with the arrow keys and jumps with Home and End, within the limits", async () => {
    const { handle, onCommit } = await setup(248);
    await key(handle, "ArrowRight");
    await key(handle, "ArrowLeft");
    await key(handle, "Home");
    await key(handle, "End");
    await key(handle, "Enter");
    expect(onCommit.mock.calls.map(([width]) => width)).toEqual([264, 232, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH]);
  });

  it("does not step past the limits", async () => {
    const { handle, onCommit } = await setup(SIDEBAR_MAX_WIDTH);
    await key(handle, "ArrowRight");
    expect(onCommit).toHaveBeenLastCalledWith(SIDEBAR_MAX_WIDTH);
  });

  it("follows a drag live and saves the final width on release", async () => {
    const { handle, onResize, onCommit, onDraggingChange } = await setup(248);
    await pointer(handle, "pointerdown", 248);
    expect(onDraggingChange).toHaveBeenLastCalledWith(true);
    await pointer(handle, "pointermove", 278);
    await pointer(handle, "pointermove", 600);
    expect(onResize.mock.calls.map(([width]) => width)).toEqual([278, SIDEBAR_MAX_WIDTH]);
    expect(onCommit).not.toHaveBeenCalled();
    await pointer(handle, "pointerup", 600);
    expect(onDraggingChange).toHaveBeenLastCalledWith(false);
    expect(onCommit).toHaveBeenCalledWith(SIDEBAR_MAX_WIDTH);
  });

  it("ignores pointer moves without a drag", async () => {
    const { handle, onResize, onCommit } = await setup(248);
    await pointer(handle, "pointermove", 300);
    await pointer(handle, "pointerup", 300);
    expect(onResize).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("resets to the default width on double-click", async () => {
    const { handle, onCommit } = await setup(330);
    await act(async () => {
      handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith(SIDEBAR_DEFAULT_WIDTH);
  });
});
