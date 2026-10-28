import type { ReactNode } from "react";

/**
 * Logo candidates for 5.8c, drawn by hand on a 32-unit grid. Each option has a full drawing and
 * a "small" drawing with heavier strokes and fewer parts that is used at 24 px and below, so the
 * favicon stays legible. Nothing outside the styleguide uses these until one is picked.
 */

export type LogoId = "flight" | "heading" | "route";
export type Treatment = "color" | "mono" | "tile";

/** The tile is the app icon and favicon. Its blue is fixed (light accent), not theme-dependent. */
export const TILE_BLUE = "#2B67D1";
const SMALL_MAX = 24;

/** minorOpacity tints the back facets (the keel, the needle tail) on the tile only. */
type Paint = { primary: string; secondary: string; minorOpacity?: number };
type Detail = "full" | "small";

function paintFor(treatment: Treatment): Paint {
  if (treatment === "tile") return { primary: "#fff", secondary: "#fff", minorOpacity: 0.6 };
  if (treatment === "mono") return { primary: "currentColor", secondary: "currentColor" };
  return { primary: "var(--sp-accent)", secondary: "var(--sp-ink)" };
}

/* A. Flight path: a folded dart climbing to the upper right, with three dots for the sessions
   behind it. The wing and keel are split along the fold, so one colour still shows the fold. */
function FlightGlyph({ paint, detail }: { paint: Paint; detail: Detail }) {
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

/* B. Heading: an open dial with a long heading needle that breaks out of it to the north-east.
   The needle's leading half is the accent; the gap between the halves keeps it readable in one
   colour. The small drawing opens the dial wider and joins the needle into one diamond. */
function HeadingGlyph({ paint, detail }: { paint: Paint; detail: Detail }) {
  if (detail === "small") {
    return (
      <g>
        <path
          d="M26.83 14.09 A11 11 0 1 1 17.91 5.17"
          fill="none"
          stroke={paint.secondary}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path d="M28 4 L12.6 12.6 L9.3 22.7 L19.4 19.4 Z" fill={paint.primary} />
      </g>
    );
  }
  return (
    <g>
      <path
        d="M26.87 12.26 A11.5 11.5 0 1 1 19.74 5.13"
        fill="none"
        stroke={paint.secondary}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M26.6 5.4 L13.45 13.45 L18.55 18.55 Z" fill={paint.primary} />
      <path d="M12.6 14.3 L17.7 19.4 L9.5 22.5 Z" fill={paint.secondary} fillOpacity={paint.minorOpacity} />
    </g>
  );
}

/* C. Route S: a monogram drawn as one route, from a start at the lower left, through two turns,
   to a heading arrow at the upper right. */
function RouteGlyph({ paint, detail }: { paint: Paint; detail: Detail }) {
  if (detail === "small") {
    return (
      <g transform="translate(0 1.6)">
        <path
          d="M6 25.5 H18.5 A4.75 4.75 0 0 0 18.5 16 H13.5 A4.75 4.75 0 0 1 13.5 6.5 H19.5"
          fill="none"
          stroke={paint.secondary}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M19 0.5 L28.5 6.5 L19 12.5 Z" fill={paint.primary} />
      </g>
    );
  }
  return (
    <g transform="translate(0 1.6)">
      <path
        d="M7 25 H18.5 A4.5 4.5 0 0 0 18.5 16 H13.5 A4.5 4.5 0 0 1 13.5 7 H20"
        fill="none"
        stroke={paint.secondary}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M19.5 1.5 L27.5 7 L19.5 12.5 Z" fill={paint.primary} />
    </g>
  );
}

const GLYPHS: Record<LogoId, (props: { paint: Paint; detail: Detail }) => ReactNode> = {
  flight: FlightGlyph,
  heading: HeadingGlyph,
  route: RouteGlyph,
};

type MarkProps = {
  option: LogoId;
  size: number;
  treatment?: Treatment;
  /** Force a drawing; by default sizes of 24 px and below use the small one. */
  detail?: Detail;
  className?: string;
};

export function LogoMark({ option, size, treatment = "color", detail, className }: MarkProps) {
  const Glyph = GLYPHS[option];
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
            <Glyph paint={paint} detail={resolved} />
          </g>
        </>
      ) : (
        <Glyph paint={paint} detail={resolved} />
      )}
    </svg>
  );
}

/**
 * Mark + Inter wordmark. Spacing rule: the mark is 1.6× the font size and sits 0.45× the font
 * size from the text (about the width of the "t"), centred on the x-height band.
 */
export function LogoLockup({
  option,
  fontSize,
  treatment = "color",
  className,
}: {
  option: LogoId;
  fontSize: number;
  treatment?: Treatment;
  className?: string;
}) {
  const mark = Math.round(fontSize * 1.6);
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.round(fontSize * 0.45),
        fontSize,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        lineHeight: 1,
        color: "var(--sp-ink)",
      }}
    >
      <LogoMark option={option} size={mark} treatment={treatment} />
      StudyPilot
    </span>
  );
}
