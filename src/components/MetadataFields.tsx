"use client";

import { useEffect, useMemo, useState } from "react";
import { suggestTagsFromTitle } from "@/lib/enrich/tags";

export interface TagOption {
  id: string;
  name: string;
  slug: string;
}
export interface PersonOption {
  id: string;
  name: string;
  slug: string;
  /** How many posts tag this person — used to order the quick-pick chips. */
  count?: number;
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
  /** Provenance line under the date input — e.g. "Suggested date: Jul 4, 2026 · from photo metadata". */
  dateHint?: React.ReactNode;
  selectedTags: string[];
  onTagsChange: (v: string[]) => void;
  /** Vision-suggested tags — tap to add. `isNew` marks a proposal that isn't
   *  in the vocabulary yet (rendered distinctly). Never auto-applied. */
  tagSuggestions?: { name: string; isNew?: boolean }[];
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
  dateHint,
  selectedTags,
  onTagsChange,
  tagSuggestions,
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

  function togglePerson(name: string) {
    onPeopleChange(
      selectedPeople.includes(name)
        ? selectedPeople.filter((p) => p !== name)
        : [...selectedPeople, name]
    );
  }

  function toggleAlbum(id: string) {
    onAlbumIdsChange(
      selectedAlbumIds.includes(id)
        ? selectedAlbumIds.filter((a) => a !== id)
        : [...selectedAlbumIds, id]
    );
  }

  const tagAutocomplete = allTags.filter(
    (t) =>
      !selectedTags.includes(t.name) &&
      t.name.toLowerCase().includes(newTag.toLowerCase()) &&
      newTag.length > 0
  );

  // Title-contains suggestions: existing tags whose name appears as a word in
  // the typed title. Closed-vocabulary (plain chips), recomputed live as the
  // user types, and merged AHEAD of the passed (vision/context) suggestions.
  const titleSuggestions = useMemo(
    () => suggestTagsFromTitle(title, allTags.map((t) => t.name)),
    [title, allTags]
  );
  const mergedSuggestions = useMemo(() => {
    const out: { name: string; isNew?: boolean }[] = [];
    const seen = new Set<string>();
    const push = (s: { name: string; isNew?: boolean }) => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(s);
    };
    for (const name of titleSuggestions) push({ name });
    for (const s of tagSuggestions ?? []) push(s);
    return out;
  }, [titleSuggestions, tagSuggestions]);

  // Suggestions still worth showing (not already picked).
  const visibleTagSuggestions = mergedSuggestions.filter(
    (s) => !selectedTags.some((t) => t.toLowerCase() === s.name.toLowerCase())
  );

  // People quick-pick: known people (already most-used-first from the API)
  // plus any ad-hoc selected names not in the list, filtered by the input.
  const peopleFilter = newPerson.trim().toLowerCase();
  const knownPeopleNames = allPeople.map((p) => p.name);
  const adHocSelected = selectedPeople.filter((n) => !knownPeopleNames.includes(n));
  const peopleChips = [...knownPeopleNames, ...adHocSelected].filter(
    (n) => !peopleFilter || n.toLowerCase().includes(peopleFilter)
  );
  const canAddNewPerson =
    peopleFilter.length > 0 &&
    ![...knownPeopleNames, ...selectedPeople].some(
      (n) => n.toLowerCase() === peopleFilter
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
        {dateHint && <div className="mt-1.5 text-xs leading-relaxed">{dateHint}</div>}
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
            {tagAutocomplete.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-[#2a2929] rounded-lg border border-[#3a3939] max-h-40 overflow-y-auto">
                {tagAutocomplete.map((t) => (
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
        {/* Vision-suggested tags — tap to add; untapped suggestions are never saved */}
        {!disabled && visibleTagSuggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-[#7d7468]">Suggested</span>
            {visibleTagSuggestions.map((s) => (
              <button
                key={s.name}
                onClick={() => addTag(s.name)}
                className={
                  s.isNew
                    ? "px-2.5 py-1 rounded-full text-sm border border-dashed border-[#c2a467]/60 text-[#c2a467] hover:bg-[#c2a467]/10 transition-colors"
                    : "px-2.5 py-1 rounded-full text-sm border border-[#3a3939] text-[#a39e93] hover:border-[#c2a467]/60 hover:text-[#c2a467] transition-colors"
                }
                title={s.isNew ? "New tag — not in your vocabulary yet" : "Add existing tag"}
              >
                + {s.name}
                {s.isNew && <span className="ml-1 text-[9px] uppercase">new</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* People — quick-pick chips, most-used first; tap to toggle */}
      <div>
        <label className="block text-xs text-[#888] mb-1">People</label>
        {!disabled && (
          <input
            type="text"
            placeholder="Filter or add a person…"
            value={newPerson}
            onChange={(e) => setNewPerson(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newPerson.trim()) {
                e.preventDefault();
                addPerson(newPerson);
              }
            }}
            className="w-full bg-[#2a2929] rounded-lg px-4 py-2.5 text-sm text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3] mb-2"
          />
        )}
        <div className="flex flex-wrap gap-1.5">
          {peopleChips.map((name) => {
            const sel = selectedPeople.includes(name);
            return (
              <button
                key={name}
                onClick={() => !disabled && togglePerson(name)}
                disabled={disabled}
                className={`px-2.5 py-1 rounded-full text-sm transition-colors disabled:opacity-50 ${
                  sel
                    ? "bg-[#427ea3] text-white"
                    : "bg-[#2a2929] text-[#a0a0a0] hover:bg-[#333]"
                }`}
              >
                {sel ? "✓ " : ""}@{name}
              </button>
            );
          })}
          {!disabled && canAddNewPerson && (
            <button
              onClick={() => addPerson(newPerson)}
              className="px-2.5 py-1 rounded-full text-sm border border-dashed border-[#427ea3]/60 text-[#427ea3] hover:bg-[#427ea3]/10 transition-colors"
            >
              + Add &ldquo;{newPerson.trim()}&rdquo;
            </button>
          )}
          {peopleChips.length === 0 && !canAddNewPerson && (
            <span className="text-xs text-[#555] py-1">No people yet — type a name to add one.</span>
          )}
        </div>
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
