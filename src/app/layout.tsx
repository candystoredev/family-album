import type { Metadata, Viewport } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";
import ArchiveMenu from "@/components/ArchiveMenu";
import AutoRefresh from "@/components/AutoRefresh";
import { getSession } from "@/lib/auth";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Hoecks",
  description: "Family Photo Album",
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
  themeColor: "#1d1c1c",
  viewportFit: "cover",
};

// Auto-derived from the deployed commit so it's always accurate — no manual
// bumping. Vercel sets VERCEL_GIT_COMMIT_SHA at build; "dev" when running local.
const BUILD_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

  return (
    <html lang="en" className="dark">
      <body className={`min-h-screen bg-[#1d1c1c] text-[#d3d3d3] antialiased ${sourceSans.className}`}>
        {children}
        <AutoRefresh buildVersion={BUILD_VERSION} />
        <ArchiveMenu isAdmin={session?.role === "admin"} isLoggedIn={!!session} buildVersion={BUILD_VERSION} />
      </body>
    </html>
  );
}
