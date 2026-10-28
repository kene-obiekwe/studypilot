import { ImageResponse } from "next/og";

import { LogoMark } from "@/components/brand";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Favicon: the fixed blue tile with the white mark (small drawing at this size). */
export default function Icon() {
  return new ImageResponse(<LogoMark size={size.width} treatment="tile" />, { ...size });
}
