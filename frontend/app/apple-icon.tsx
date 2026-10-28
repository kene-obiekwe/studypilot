import { ImageResponse } from "next/og";

import { LogoMark, TILE_BLUE } from "@/components/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the same tile at 180 px (full drawing). Full-bleed blue behind the tile, because iOS rounds the corners itself. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: TILE_BLUE }}>
        <LogoMark size={size.width} treatment="tile" />
      </div>
    ),
    { ...size },
  );
}
