import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import FavoritesGrid from "./FavoritesGrid";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      <div className="max-w-[900px] mx-auto px-4 py-8">
        <FavoritesGrid />
      </div>
    </main>
  );
}
