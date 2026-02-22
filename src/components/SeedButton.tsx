"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SeedButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSeed() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Seed failed");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="text-center">
      <button
        onClick={handleSeed}
        disabled={loading}
        className="px-6 py-3 bg-[#427ea3] text-white rounded-lg font-medium hover:bg-[#4d8fb5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Seeding..." : "Seed test data"}
      </button>
      <p className="text-[#555] text-xs mt-2">
        Creates 3 test posts with photos in R2
      </p>
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
    </div>
  );
}
