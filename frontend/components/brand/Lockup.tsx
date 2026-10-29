import { LogoMark, type Treatment } from "./LogoMark";

/**
 * Mark + Inter wordmark. Spacing rule: the mark is 1.6× the font size and sits 0.45× the font
 * size from the text (about the width of the "t"), centred on the x-height band.
 */
export function Lockup({
  fontSize,
  treatment = "color",
  className,
}: {
  fontSize: number;
  treatment?: Treatment;
  className?: string;
}) {
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
      <LogoMark size={Math.round(fontSize * 1.6)} treatment={treatment} />
      StudyPilot
    </span>
  );
}
