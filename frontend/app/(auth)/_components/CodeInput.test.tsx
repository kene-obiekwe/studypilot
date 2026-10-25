// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, paste, render, typeInto } from "@/test/dom";

import { CodeInput } from "./CodeInput";

afterEach(cleanup);

function Harness({ onComplete }: { onComplete: (code: string) => void }) {
  const [value, setValue] = useState("");
  return <CodeInput value={value} onChange={setValue} onComplete={onComplete} />;
}

async function mount() {
  const onComplete = vi.fn<(code: string) => void>();
  const view = await render(<Harness onComplete={onComplete} />);
  const input = view.container.querySelector("input") as HTMLInputElement;
  return { input, onComplete };
}

describe("CodeInput", () => {
  it("asks for a numeric keypad and the code from the email app", async () => {
    const { input } = await mount();
    expect(input.inputMode).toBe("numeric");
    expect(input.autocomplete).toBe("one-time-code");
    expect(input.maxLength).toBe(6);
    expect(input.pattern).toBe("[0-9]*");
  });

  it("keeps digits only while typing", async () => {
    const { input } = await mount();
    await typeInto(input, "12a3-4");
    expect(input.value).toBe("1234");
  });

  it("allows at most 6 digits", async () => {
    const { input } = await mount();
    await typeInto(input, "1234567890");
    expect(input.value).toBe("123456");
  });

  it("calls onComplete once, when the sixth digit arrives", async () => {
    const { input, onComplete } = await mount();
    await typeInto(input, "12345");
    expect(onComplete).not.toHaveBeenCalled();
    await typeInto(input, "123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("takes a pasted code in full, with the spaces, dashes and newline stripped", async () => {
    const { input, onComplete } = await mount();
    const prevented = await paste(input, " 123 456\n");
    expect(prevented).toBe(true); // maxLength would otherwise cut the paste short
    expect(input.value).toBe("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");

    await paste(input, "654-321");
    expect(input.value).toBe("654321");
  });

  it("truncates a longer paste and ignores one with no digits", async () => {
    const { input, onComplete } = await mount();
    await paste(input, "98765432");
    expect(input.value).toBe("987654");
    expect(onComplete).toHaveBeenCalledWith("987654");

    onComplete.mockClear();
    await typeInto(input, "");
    await paste(input, "abc def");
    expect(input.value).toBe("");
    expect(onComplete).not.toHaveBeenCalled();
  });
});
