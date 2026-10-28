/**
 * The StudyPilot mark: a folded dart climbing to the upper right, trailing three dots for the
 * sessions behind it. Drawn on a 32-unit grid. A "small" drawing with heavier shapes and no dots
 * is used at 24 px and below so the favicon and tab icon stay legible.
 */

export type Treatment = "color" | "mono" | "tile";
type Detail = "full" | "small";

/** The tile is the app icon and favicon. Its blue is fixed (light accent), not theme-dependent. */
export const TILE_BLUE = "#2B67D1";
const SMALL_MAX = 24;

/** minorOpacity tints the back facet (the keel) on the tile only. */
type Paint = { primary: string; secondary: string; minorOpacity?: number };

function paintFor(treatment: Treatment): Paint {
  if (treatment === "tile") return { primary: "#fff", secondary: "#fff", minorOpacity: 0.6 };
  if (treatment === "mono") return { primary: "currentColor", secondary: "currentColor" };
  return { primary: "var(--sp-accent)", secondary: "var(--sp-ink)" };
}

/* Called as a function, not rendered as a component: ImageResponse (the icons) only accepts
   intrinsic elements inside <svg>. The wing and keel are split along the fold, so one colour still shows the fold. */
function glyph(paint: Paint, detail: Detail) {
  if (detail === "small") {
    return (
      <g transform="translate(-1.5 1.5)">
        <path d="M28 4 L4 12.5 L14.6 16.6 Z" fill={paint.primary} />
        <path d="M28 4 L16.6 18.6 L20.5 28 Z" fill={paint.secondary} fillOpacity={paint.minorOpacity} />
      </g>
    );
  }
  return (
    <g>
      <path d="M29.5 2.5 L9 10.2 L17.3 14 Z" fill={paint.primary} />
      <path d="M29.5 2.5 L18.6 15.6 L21.8 24.5 Z" fill={paint.secondary} fillOpacity={paint.minorOpacity} />
      <circle cx="3.6" cy="28.6" r="1.8" fill={paint.primary} />
      <circle cx="7.9" cy="24.7" r="2.2" fill={paint.primary} />
      <circle cx="12.8" cy="21.4" r="2.6" fill={paint.primary} />
    </g>
  );
}

type LogoMarkProps = {
  size: number;
  treatment?: Treatment;
  /** Force a drawing; by default sizes of 24 px and below use the small one. */
  detail?: Detail;
  className?: string;
};

/** Decorative: the wordmark text names the link, so the mark is hidden from assistive tech. */
export function LogoMark({ size, treatment = "color", detail, className }: LogoMarkProps) {
  const resolved = detail ?? (size <= SMALL_MAX ? "small" : "full");
  const paint = paintFor(treatment);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      {treatment === "tile" ? (
        <>
          <rect width="32" height="32" rx="7.5" fill={TILE_BLUE} />
          <g transform={resolved === "small" ? "translate(3.2 3.2) scale(0.8)" : "translate(5.5 5.5) scale(0.66)"}>
            {glyph(paint, resolved)}
          </g>
        </>
      ) : (
        glyph(paint, resolved)
      )}
    </svg>
  );
}
