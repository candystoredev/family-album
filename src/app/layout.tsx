import type { Metadata, Viewport } from "next";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import ArchiveMenu from "@/components/ArchiveMenu";
import AutoRefresh from "@/components/AutoRefresh";
import BackButton from "@/components/BackButton";
import PullToRefresh from "@/components/PullToRefresh";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { getSession } from "@/lib/auth";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// Brand/display voice — wordmark, "The Latest", page titles, year numerals.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "The Hoecks",
  description: "Family Photo Album",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "The Hoecks",
    statusBarStyle: "black-translucent",
  },
  // Next 15's appleWebApp.capable emits the modern `mobile-web-app-capable`
  // name, but iOS only enters standalone mode for the legacy Apple tag — so
  // set it explicitly here.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

// viewportFit cover extends the layout viewport under the iOS status bar in
// standalone mode — without it, fixed inset-0 overlays (the lightbox) stop
// short of the screen top and the page shows through. Body safe-area padding
// in globals.css keeps normal content below the notch.
export const viewport: Viewport = {
  themeColor: "#1a1918",
  viewportFit: "cover",
};

// Auto-derived from the deployed commit so it's always accurate — no manual
// bumping. Vercel sets VERCEL_GIT_COMMIT_SHA at build; "dev" when running local.
const BUILD_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";

export default async function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  // @modal parallel slot — holds the intercepted /today slide-down sheet.
  modal: React.ReactNode;
}>) {
  const session = await getSession();

  return (
    <html lang="en" className={`dark ${sourceSans.variable} ${sourceSerif.variable}`}>
      <body className={`min-h-screen bg-[#1a1918] text-[#c9c4ba] antialiased ${sourceSans.className}`}>
        {children}
        {modal}
        <PullToRefresh />
        <BackButton />
        <AutoRefresh buildVersion={BUILD_VERSION} />
        <ServiceWorkerRegister />
        <ArchiveMenu isAdmin={session?.role === "admin"} isLoggedIn={!!session} buildVersion={BUILD_VERSION} />
      </body>
    </html>
  );
}
