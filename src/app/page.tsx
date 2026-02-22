import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      <header className="border-b border-[#2a2929]">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between">
          <h1 className="text-[#d3d3d3] text-xl font-light tracking-wide">
            The Hoecks
          </h1>
          <div className="flex items-center gap-4">
            {session.role === "admin" && (
              <span className="text-xs text-[#427ea3] border border-[#427ea3] px-2 py-1 rounded">
                Admin
              </span>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-[#666] text-center">
          No posts yet. The feed will appear here.
        </p>
      </div>
    </main>
  );
}
