import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";
import ArchiveMenu from "@/components/ArchiveMenu";
import { getSession } from "@/lib/auth";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Hoecks",
  description: "Family Photo Album",
  robots: { index: false, follow: false },
};

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
        <ArchiveMenu isAdmin={session?.role === "admin"} isLoggedIn={!!session} />
      </body>
    </html>
  );
}
