// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, click, flush, render } from "@/test/dom";

import { HeroVideo } from "./HeroVideo";
import { HERO_POSTER } from "./media";

let reducedMotion = false;

function stubMatchMedia() {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("reduce") && reducedMotion,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom has no media playback: play() and pause() fire the events a browser would.
function stubPlayback(result: "plays" | "blocked" = "plays") {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    if (result === "blocked") return Promise.reject(new DOMException("blocked", "NotAllowedError"));
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
  return { play, pause };
}

async function renderVideo() {
  const { container } = await render(<HeroVideo />);
  await flush();
  const video = container.querySelector("video")!;
  // A writable playhead per element, so the test can see whether anything resets it.
  Object.defineProperty(video, "currentTime", { value: 0, writable: true, configurable: true });
  return { container, video };
}

async function finish(video: HTMLVideoElement) {
  video.currentTime = 10;
  Object.defineProperty(video, "ended", { get: () => true, configurable: true });
  await act(async () => {
    video.dispatchEvent(new Event("pause"));
    video.dispatchEvent(new Event("ended"));
  });
}

function button(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === name,
  );
}

beforeEach(() => {
  reducedMotion = false;
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HeroVideo", () => {
  it("plays once, muted and inline, without looping", async () => {
    const { play } = stubPlayback();
    const { container, video } = await renderVideo();

    expect(play).toHaveBeenCalledTimes(1);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.loop).toBe(false);
    expect(video.getAttribute("aria-hidden")).toBe("true");
    // While it plays it can be paused (it runs for longer than 5 seconds).
    expect(button(container, "Pause animation")).toBeDefined();
  });

  it("holds on the final frame when it ends and offers Replay", async () => {
    const { play } = stubPlayback();
    const { container, video } = await renderVideo();

    await finish(video);

    expect(video.currentTime).toBe(10);
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("ended");
    expect(button(container, "Replay animation")).toBeDefined();
  });

  it("Replay restarts from the beginning", async () => {
    const { play } = stubPlayback();
    const { container, video } = await renderVideo();
    await finish(video);

    await click(button(container, "Replay animation")!);

    expect(video.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);
    expect(button(container, "Pause animation")).toBeDefined();
  });

  it("under reduced motion it doesn't autoplay: the poster and a Play button show", async () => {
    reducedMotion = true;
    const { play } = stubPlayback();
    const { container, video } = await renderVideo();

    expect(play).not.toHaveBeenCalled();
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("idle");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(HERO_POSTER);

    await click(button(container, "Play animation")!);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("shows Play when the browser blocks autoplay", async () => {
    stubPlayback("blocked");
    const { container } = await renderVideo();

    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("blocked");
    expect(button(container, "Play animation")).toBeDefined();
  });

  it("Pause stops it part-way and Play resumes without restarting", async () => {
    const { play, pause } = stubPlayback();
    const { container, video } = await renderVideo();
    video.currentTime = 4;

    await click(button(container, "Pause animation")!);
    expect(pause).toHaveBeenCalledTimes(1);

    await click(button(container, "Play animation")!);
    expect(video.currentTime).toBe(4);
    expect(play).toHaveBeenCalledTimes(2);
  });
});
