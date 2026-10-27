import type { Metadata } from "next";

import { HEADLINE, LandingPage, SUBCOPY } from "@/components/landing/LandingPage";
import { HERO_POSTER } from "@/components/landing/media";

// Open Graph images need an absolute URL. Set NEXT_PUBLIC_SITE_URL once the site has a domain;
// until then Next falls back to the local origin.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: "StudyPilot: a study plan that adapts to how you study",
  description: SUBCOPY,
  openGraph: {
    type: "website",
    siteName: "StudyPilot",
    title: HEADLINE,
    description: SUBCOPY,
    images: [
      {
        url: HERO_POSTER,
        width: 1280,
        height: 720,
        alt: "A student at a laptop with cards for a study timetable, learning strategies and progress tracking.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: HEADLINE,
    description: SUBCOPY,
    images: [HERO_POSTER],
  },
};

export default function RootPage() {
  return <LandingPage />;
}
