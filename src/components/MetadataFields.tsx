"use client";

import { useEffect, useState } from "react";

export interface TagOption {
  id: string;
  name: string;
  slug: string;
}
export interface PersonOption {
  id: string;
  name: string;
  slug: string;
}
export interface AlbumOption {
  id: string;
  title: string;
  slug: string;
}

export interface MetadataOptions {
  allTags: TagOption[];
  allPeople: PersonOption[];
  allAlbums: AlbumOption[];
}

/** Fetch tag/people/album options once on mount. */
export function useMetadataOptions(): MetadataOptions {
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [allPeople, setAllPeople] = useState<PersonOption[]>([]);
  const [allAlbums, setAllAlbums] = useState<AlbumOption[]>([]);

  useEffect(() => {
    fetch("/api/admin/tags")
      .then((r) => r.json())
      .then(setAllTags)
      .catch(() => {});
    fetch("/api/admin/people")
      .then((r) => r.json())
      .then(setAllPeople)
      .catch(() => {});
    fetch("/api/admin/albums")
      .then((r) => r.json())
      .then(setAllAlbums)
      .catch(() => {});
  }, []);

  return { allTags, allPeople, allAlbums };
}

interface MetadataFieldsProps {
  options: MetadataOptions;
  title: string;
  onTitleChange: (v: string) => void;
  date: string;
  onDateChange: (v: string) => void;
  dateLabel?: string;
  selectedTags: string[];
  onTagsChange: (v: string[]) => void;
  selectedPeople: string[];
  onPeopleChange: (v: string[]) => void;
  selectedAlbumIds: string[];
  onAlbumIdsChange: (v: string[]) => void;
  disabled?: boolean;
}

export default function MetadataFields({
  options,
  title,
  onTitleChange,
  date,
  onDateChange,
  dateLabel = "Date (auto-detected from photo EXIF if left empty)",
  selectedTags,
  onTagsChange,
  selectedPeople,
  onPeopleChange,
  selectedAlbumIds,
  onAlbumIdsChange,
  disabled = false,
}: MetadataFieldsProps) {
  const { allTags, allPeople, allAlbums } = options;
  const [newTag, setNewTag] = useState("");
  const [newPerson, setNewPerson] = useState("");

  function addTag(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!selectedTags.includes(trimmed)) onTagsChange([...selectedTags, trimmed]);
    setNewTag("");
  }

  function addPerson(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!selectedPeople.includes(trimmed)) onPeopleChange([...selectedPeople, trimmed]);
    setNewPerson("");
  }

  function toggleAlbum(id: string) {
    onAlbumIdsChange(
      selectedAlbumIds.includes(id)
        ? selectedAlbumIds.filter((a) => a !== id)
        : [...selectedAlbumIds, id]
    );
  }

  const tagSuggestions = allTags.filter(
    (t) =>
      !selectedTags.includes(t.name) &&
      t.name.toLowerCase().includes(newTag.toLowerCase()) &&
      newTag.length > 0
  );

  const peopleSuggestions = allPeople.filter(
    (p) =>
      !selectedPeople.includes(p.name) &&
      p.name.toLowerCase().includes(newPerson.toLowerCase()) &&
      newPerson.length > 0
  );

  return (
    <>
      {/* Title */}
      <input
        type="text"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-[#2a2929] rounded-lg px-4 py-3 text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3] disabled:opacity-50"
      />

      {/* Date */}
      <div>
        <label className="block text-xs text-[#888] mb-1">{dateLabel}</label>
        <input
          type="datetime-local"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          disabled={disabled}
          className="w-full bg-[#2a2929] rounded-lg px-4 py-3 text-[#d3d3d3] outline-none focus:ring-1 focus:ring-[#427ea3] disabled:opacity-50"
        />
      </div>

      {/* Tags */}
      <div>
        <label className="block text-xs text-[#888] mb-1">Tags</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 bg-[#2a2929] rounded text-sm text-[#a0a0a0]"
            >
              #{tag}
              {!disabled && (
                <button
                  onClick={() => onTagsChange(selectedTags.filter((t) => t !== tag))}
                  className="text-[#666] hover:text-[#d86d6d] ml-0.5"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {!disabled && (
          <div className="relative">
            <input
              type="text"
              placeholder="Add tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTag.trim()) {
                  e.preventDefault();
                  addTag(newTag);
                }
              }}
              className="w-full bg-[#2a2929] rounded-lg px-4 py-2.5 text-sm text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3]"
            />
            {tagSuggestions.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-[#2a2929] rounded-lg border border-[#3a3939] max-h-40 overflow-y-auto">
                {tagSuggestions.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => addTag(t.name)}
                    className="w-full text-left px-4 py-2 text-sm text-[#a0a0a0] hover:bg-[#333] hover:text-[#d3d3d3]"
                  >
                    #{t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* People */}
      <div>
        <label className="block text-xs text-[#888] mb-1">People</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedPeople.map((person) => (
            <span
              key={person}
              className="inline-flex items-center gap-1 px-2 py-1 bg-[#2a2929] rounded text-sm text-[#a0a0a0]"
            >
              @{person}
              {!disabled && (
                <button
                  onClick={() => onPeopleChange(selectedPeople.filter((p) => p !== person))}
                  className="text-[#666] hover:text-[#d86d6d] ml-0.5"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {!disabled && (
          <div className="relative">
            <input
              type="text"
              placeholder="Add person..."
              value={newPerson}
              onChange={(e) => setNewPerson(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPerson.trim()) {
                  e.preventDefault();
                  addPerson(newPerson);
                }
              }}
              className="w-full bg-[#2a2929] rounded-lg px-4 py-2.5 text-sm text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3]"
            />
            {peopleSuggestions.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-[#2a2929] rounded-lg border border-[#3a3939] max-h-40 overflow-y-auto">
                {peopleSuggestions.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addPerson(p.name)}
                    className="w-full text-left px-4 py-2 text-sm text-[#a0a0a0] hover:bg-[#333] hover:text-[#d3d3d3]"
                  >
                    @{p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Albums */}
      {allAlbums.length > 0 && (
        <div>
          <label className="block text-xs text-[#888] mb-1">Albums</label>
          <div className="flex flex-wrap gap-1.5">
            {allAlbums.map((album) => (
              <button
                key={album.id}
                onClick={() => !disabled && toggleAlbum(album.id)}
                disabled={disabled}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  selectedAlbumIds.includes(album.id)
                    ? "bg-[#427ea3] text-white"
                    : "bg-[#2a2929] text-[#a0a0a0] hover:bg-[#333]"
                } disabled:opacity-50`}
              >
                {album.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
