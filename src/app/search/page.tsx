import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getImessageRecipients } from "@/lib/feed";
import SearchResults from "./SearchResults";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { q } = await searchParams;
  const imessageRecipients = await getImessageRecipients();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      <SearchResults
        initialQuery={q || ""}
        siteUrl={siteUrl}
        imessageRecipients={imessageRecipients}
      />
    </main>
  );
}
