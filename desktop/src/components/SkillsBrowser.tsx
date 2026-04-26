import { useEffect, useState } from "react";
import { useConnectionStore } from "../store/connectionStore";
import { useFeatureStore } from "../store/featureStore";

export function SkillsBrowser() {
  const ws = useConnectionStore((s) => s.ws);
  const skills = useFeatureStore((s) => s.skills);
  const setSkills = useFeatureStore((s) => s.setSkills);
  const [search, setSearch] = useState("");

  useEffect(() => {
    ws.send({ type: "list_skills" });
    const unsub = ws.onMessage((msg) => {
      if (msg.type === "skills_list" && Array.isArray(msg.skills)) {
        setSkills(msg.skills as typeof skills);
      }
    });
    return unsub;
  }, [ws, setSkills]);

  const filtered = skills.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-(--color-text)">Skills</h2>
        <span className="rounded-full bg-(--color-surface-dim) px-2 py-0.5 text-xs text-(--color-text-muted)">
          {skills.length}
        </span>
      </div>
      <input
        type="search"
        placeholder="Filter by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-(--color-border) bg-(--color-surface-dim) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-text-muted) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
      />
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-(--color-text-muted)">
          {search ? "No skills match your filter." : "No skills available."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {filtered.map((skill) => (
            <li
              key={skill.name}
              className="rounded-lg border border-(--color-border) bg-(--color-surface) p-4 hover:bg-(--color-surface-dim) transition-colors"
            >
              <p className="font-mono text-sm font-medium text-(--color-accent)">
                {skill.name}
              </p>
              {skill.description && (
                <p className="mt-1 text-sm text-(--color-text-muted)">
                  {skill.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
