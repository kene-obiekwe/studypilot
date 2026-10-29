// @vitest-environment jsdom
import { act } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { cleanup, render } from "@/test/dom";
import { clearSession, setSession } from "@/lib/session";

import { AuthActions } from "./AuthActions";
import { LandingPage } from "./LandingPage";

function links(container: HTMLElement) {
  return [...container.querySelectorAll("a")].map((a) => [a.textContent?.trim(), a.getAttribute("href")]);
}

afterEach(() => {
  cleanup();
  clearSession();
});

describe("AuthActions", () => {
  it("signed out: Get started goes to sign-up and Sign in to sign-in", async () => {
    const { container } = await render(<AuthActions placement="hero" />);
    expect(links(container)).toEqual([
      ["Get started", "/sign-up"],
      ["Sign in", "/sign-in"],
    ]);
    expect(container.querySelector("[data-pending]")).toBeNull();
  });

  it("signed in: one Go to your week link to /home instead", async () => {
    setSession({ access: "a", refresh: "r" });
    const hero = await render(<AuthActions placement="hero" />);
    const header = await render(<AuthActions placement="header" />);
    expect(links(hero.container)).toEqual([["Go to your week", "/home"]]);
    expect(links(header.container)).toEqual([["Go to your week", "/home"]]);
  });

  it("swaps when another tab signs in", async () => {
    const { container } = await render(<AuthActions placement="header" />);
    expect(links(container).map(([text]) => text)).toEqual(["Sign in", "Get started"]);

    setSession({ access: "a", refresh: "r" });
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "fyp_access_token" }));
    });
    expect(links(container)).toEqual([["Go to your week", "/home"]]);
  });

  it("in the static HTML the buttons are hidden and inert until the session is known", () => {
    const html = renderToString(<AuthActions placement="hero" />);
    expect(html).toContain("data-pending");
    expect(html).toContain("inert");
  });
});

describe("LandingPage", () => {
  it("has one h1, the evaluation and repo links, and the credit", () => {
    const html = renderToString(<LandingPage />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("https://github.com/kene-obiekwe/studypilot/blob/master/docs/evaluation-report.md");
    expect(html).toContain('href="https://github.com/kene-obiekwe/studypilot"');
    expect(html).toContain("Built by Kene Obiekwe");
    expect(html).toContain("<main");
    expect(html).toContain("<footer");
  });
});
