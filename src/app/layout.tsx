import type { Metadata } from "next";
import "./globals.css";
import ArchiveMenu from "@/components/ArchiveMenu";

export const metadata: Metadata = {
  title: "The Hoecks",
  description: "Family Photo Album",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#1d1c1c] text-[#d3d3d3] antialiased">
        {children}
        <ArchiveMenu />
      </body>
    </html>
  );
}
