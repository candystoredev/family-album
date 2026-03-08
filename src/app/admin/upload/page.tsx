"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type UploadState = "idle" | "uploading" | "success" | "error";

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    slug: string;
    exifDate: string | null;
    dimensions: { width: number; height: number };
  } | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    setFile(f);
    setError("");
    setState("idle");

    // Show preview
    const url = URL.createObjectURL(f);
    setPreview(url);

    // Clear date so server can extract from EXIF
    setDate("");
  }

  async function handleUpload() {
    if (!file) return;

    setState("uploading");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (title.trim()) formData.append("title", title.trim());
      if (date) formData.append("date", date);

      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setState("error");
        setError(data.error || "Upload failed");
        return;
      }

      setState("success");
      setResult(data);

      // Redirect to the new post after a brief moment
      setTimeout(() => {
        router.push(`/posts/${data.slug}`);
      }, 1500);
    } catch {
      setState("error");
      setError("Network error — please try again");
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setTitle("");
    setDate("");
    setState("idle");
    setError("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="min-h-screen bg-[#1d1c1c] text-[#d3d3d3] px-4 py-8">
      <div className="max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-6">Upload Photo</h1>

        {/* File picker */}
        {!file && (
          <label className="block border-2 border-dashed border-[#3a3939] rounded-xl p-12 text-center cursor-pointer hover:border-[#427ea3] transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="text-[#888] space-y-2">
              <div className="text-4xl">+</div>
              <div className="text-sm">Tap to choose a photo</div>
            </div>
          </label>
        )}

        {/* Preview + form */}
        {file && preview && (
          <div className="space-y-4">
            {/* Image preview */}
            <div className="relative rounded-xl overflow-hidden bg-[#141313]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Preview"
                className="w-full max-h-[60vh] object-contain"
              />
              {state === "idle" && (
                <button
                  onClick={reset}
                  className="absolute top-3 right-3 w-8 h-8 bg-black/60 rounded-full text-white text-sm flex items-center justify-center"
                >
                  X
                </button>
              )}
            </div>

            {/* Title */}
            <input
              type="text"
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={state === "uploading" || state === "success"}
              className="w-full bg-[#2a2929] rounded-lg px-4 py-3 text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3] disabled:opacity-50"
            />

            {/* Date override */}
            <div>
              <label className="block text-xs text-[#888] mb-1">
                Date (auto-detected from photo if left empty)
              </label>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={state === "uploading" || state === "success"}
                className="w-full bg-[#2a2929] rounded-lg px-4 py-3 text-[#d3d3d3] outline-none focus:ring-1 focus:ring-[#427ea3] disabled:opacity-50"
              />
            </div>

            {/* Upload button */}
            {state === "idle" && (
              <button
                onClick={handleUpload}
                className="w-full bg-[#427ea3] text-white rounded-lg py-3 font-semibold hover:bg-[#3a6f91] transition-colors"
              >
                Upload
              </button>
            )}

            {/* Uploading state */}
            {state === "uploading" && (
              <div className="text-center py-3 text-[#888]">
                <div className="inline-block w-5 h-5 border-2 border-[#427ea3] border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                Uploading...
              </div>
            )}

            {/* Success state */}
            {state === "success" && result && (
              <div className="bg-[#1a2e1a] border border-[#2d4a2d] rounded-lg p-4 space-y-1">
                <div className="text-[#6db86d] font-semibold">
                  Photo uploaded!
                </div>
                <div className="text-xs text-[#888]">
                  {result.dimensions.width} x {result.dimensions.height}px
                  {result.exifDate && (
                    <>
                      {" "}
                      &middot; Taken{" "}
                      {new Date(result.exifDate).toLocaleDateString()}
                    </>
                  )}
                </div>
                <div className="text-xs text-[#888]">
                  Redirecting to post...
                </div>
              </div>
            )}

            {/* Error state */}
            {state === "error" && (
              <div className="space-y-3">
                <div className="bg-[#2e1a1a] border border-[#4a2d2d] rounded-lg p-4 text-[#d86d6d]">
                  {error}
                </div>
                <button
                  onClick={() => setState("idle")}
                  className="w-full bg-[#2a2929] text-[#d3d3d3] rounded-lg py-3 hover:bg-[#333] transition-colors"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}

        {/* Back link */}
        <div className="mt-8 text-center">
          <a
            href="/"
            className="text-sm text-[#888] hover:text-[#427ea3] transition-colors"
          >
            Back to feed
          </a>
        </div>
      </div>
    </div>
  );
}
