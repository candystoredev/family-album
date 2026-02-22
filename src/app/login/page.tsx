"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError("Wrong password");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#1d1c1c] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-[#d3d3d3] text-2xl font-light tracking-wide text-center mb-8">
          The Hoecks
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Family password"
            autoFocus
            className="w-full px-4 py-3 bg-[#2a2929] border border-[#3a3939] rounded-lg text-[#d3d3d3] placeholder-[#666] focus:outline-none focus:border-[#427ea3] transition-colors"
          />
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 bg-[#427ea3] text-white rounded-lg font-medium hover:bg-[#4d8fb5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "..." : "Enter"}
          </button>
        </form>
      </div>
    </main>
  );
}
