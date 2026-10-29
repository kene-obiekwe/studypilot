"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui";

import styles from "./landing.module.css";
import { HERO_POSTER, HERO_VIDEO_MP4, HERO_VIDEO_WEBM } from "./media";

/**
 * idle: not started yet. blocked: the browser refused to autoplay. paused: stopped part-way by
 * the visitor. ended: finished and holding on its final frame (no loop, nothing resets it).
 */
type Status = "idle" | "blocked" | "playing" | "paused" | "ended";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}

/** Unknown on the server and during hydration, so neither autoplay nor a Play button is guessed. */
const unknownOnServer = (): boolean | null => null;

/**
 * The hero animation: plays once and holds on its last frame, with a small Replay button.
 * Under reduced motion it never starts on its own; the poster (the final frame) shows with a
 * "Play animation" button. A Pause button shows while it plays (it runs for more than 5 s).
 *
 * The poster is an image layer rather than the video's poster attribute, so that when motion is
 * allowed the first paint matches the video's opening frame (an empty blue scene) instead of
 * jumping from the finished scene back to the start.
 */
export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const autoplayTried = useRef(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotion, prefersReducedMotion, unknownOnServer);
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (reducedMotion === true && !video.paused) {
      video.pause();
      return;
    }
    if (reducedMotion === false && !autoplayTried.current) {
      autoplayTried.current = true;
      video.play().catch(() => setStatus("blocked"));
    }
  }, [reducedMotion]);

  const play = (fromStart: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    if (fromStart) video.currentTime = 0;
    video.play().catch(() => setStatus("blocked"));
  };

  let control: React.ReactNode = null;
  if (status === "playing") {
    control = (
      <Button size="sm" icon={<Pause size={14} />} aria-label="Pause animation" onClick={() => videoRef.current?.pause()}>
        Pause
      </Button>
    );
  } else if (status === "ended") {
    control = (
      <Button size="sm" icon={<RotateCcw size={14} />} aria-label="Replay animation" onClick={() => play(true)}>
        Replay
      </Button>
    );
  } else if (status === "paused" || status === "blocked" || (status === "idle" && reducedMotion === true)) {
    control = (
      <Button size="sm" icon={<Play size={14} />} onClick={() => play(false)}>
        Play animation
      </Button>
    );
  }

  return (
    // The frame keeps light tokens in both themes: the animation itself is light.
    <div className={styles.frame} data-theme="light">
      <div className={styles.media} data-status={status}>
        <video
          ref={videoRef}
          className={styles.video}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          onPlay={() => setStatus("playing")}
          onPause={(event) => setStatus(event.currentTarget.ended ? "ended" : "paused")}
          onEnded={() => setStatus("ended")}
        >
          <source src={HERO_VIDEO_WEBM} type="video/webm" />
          <source src={HERO_VIDEO_MP4} type="video/mp4" />
        </video>
        {/* A plain img: the poster is already sized and compressed, and must paint before any JS. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.poster} src={HERO_POSTER} alt="" aria-hidden="true" width={1280} height={720} fetchPriority="high" />
        <p className={styles.srOnly}>
          Animation: a student works at a laptop while three cards appear around them, for a personalised study
          timetable, learning strategies, and tracking progress.
        </p>
        {control && <div className={styles.videoControl}>{control}</div>}
      </div>
    </div>
  );
}
