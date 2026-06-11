import type { Metadata } from "next";
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
        <div className="w-full bg-green-500 text-black text-center text-xs py-1 font-medium">
          Under construction! :) &nbsp;Version: {BUILD_VERSION}
        </div>
        {children}
        <AutoRefresh buildVersion={BUILD_VERSION} />
        <ArchiveMenu isAdmin={session?.role === "admin"} isLoggedIn={!!session} />
      </body>
    </html>
  );
}
