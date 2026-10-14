import { useState } from "react";
import {
  Box,
  ChevronRight,
  Cpu,
  Eye,
  EyeOff,
  Layers3,
  Link2,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { catalog } from "../domain";
import type { Template } from "../domain";
import { useStudio } from "../store";

function Glyph({ template, color }: { template: string; color: string }) {
  if (template === "cylinder")
    return (
      <svg viewBox="0 0 100 70" aria-hidden="true">
        <path d="M26 25v25c0 15 48 15 48 0V25" fill={color} opacity=".8" />
        <ellipse cx="50" cy="25" rx="24" ry="11" fill={color} />
        <ellipse cx="50" cy="25" rx="8" ry="4" fill="#3c443e" />
        <path
          d="M26 25c0 15 48 15 48 0"
          fill="none"
          stroke="#fff"
          opacity=".35"
        />
      </svg>
    );
  if (["cores3", "sg90", "pca9685"].includes(template))
    return (
      <svg viewBox="0 0 100 70" aria-hidden="true">
        <path d="M23 22l32-10 25 17-33 12z" fill={color} />
        <path d="M23 22v27l24 15V41z" fill={color} opacity=".8" />
        <path d="M47 41l33-12v25L47 64z" fill={color} opacity=".55" />
        <path
          d="M28 29l15 10v16L28 45z"
          fill="#c8e798"
          opacity={template === "cores3" ? 1 : 0.5}
        />
      </svg>
    );
  return (
    <svg viewBox="0 0 100 70" aria-hidden="true">
      <path d="M18 24l35-14 30 18-35 15z" fill={color} />
      <path d="M18 24v24l30 17V43z" fill={color} opacity=".8" />
      <path d="M48 43l35-15v24L48 65z" fill={color} opacity=".55" />
      {["head", "enclosure"].includes(template) && (
        <path d="M26 25l27-10 22 13-27 11z" fill="#414b40" />
      )}
    </svg>
  );
}
export default function Library({ onImport }: { onImport: () => void }) {
  const [tab, setTab] = useState<"project" | "library">("project"),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("Wszystko");
  const state = useStudio();
  const items = catalog.filter(
    (c) =>
      (category === "Wszystko" || c.category === category) &&
      c.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <aside className="library-panel">
      <div className="panel-tabs">
        <button
          className={tab === "project" ? "active" : ""}
          onClick={() => setTab("project")}
        >
          <Layers3 size={15} />
          Projekt
        </button>
        <button
          className={tab === "library" ? "active" : ""}
          onClick={() => setTab("library")}
        >
          <Box size={15} />
          Biblioteka
        </button>
      </div>
      {tab === "project" ? (
        <>
          <div className="panel-heading">
            <span>ELEMENTY SCENY</span>
            <span>{state.project.parts.length}</span>
          </div>
          <div className="tree-root">
            <ChevronRight size={13} />
            <Layers3 size={14} />
            <span>{state.project.name}</span>
          </div>
          <div className="part-tree">
            {state.project.parts.map((p) => (
              <div
                key={p.id}
                className={`tree-item ${state.selectedId === p.id ? "selected" : ""} ${!p.visible ? "muted" : ""}`}
              >
                <button
                  className="tree-select"
                  onClick={() => state.select(p.id)}
                >
                  {p.role === "reference" ? (
                    <Cpu size={15} />
                  ) : (
                    <Box size={15} />
                  )}
                  <span>{p.name}</span>
                  {p.fit_to && <Link2 size={11} />}
                </button>
                <button
                  className="visibility"
                  aria-label={`${p.visible ? "Ukryj" : "Pokaż"} ${p.name}`}
                  onClick={() => state.update(p.id, { visible: !p.visible })}
                >
                  {p.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
            ))}
          </div>
          <button className="add-part" onClick={() => setTab("library")}>
            <Plus size={15} />
            Dodaj element
          </button>
          <div className="project-note">
            <span className="note-dot" />
            <div>
              <strong>Prototyp PICO</strong>
              <p>
                Edytowalny szkic obudowy. Mocowania i zakres ruchu wymagają
                fizycznej przymiarki.
              </p>
            </div>
          </div>
          <div className="left-footer">
            <span>
              <i className="dot" />
              Zapis lokalny
            </span>
            <small>Pliki importów przechowuje backend</small>
          </div>
        </>
      ) : (
        <>
          <label className="search">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Znajdź element…"
              aria-label="Znajdź element"
            />
          </label>
          <div className="category-tabs">
            {["Wszystko", "Konstrukcja", "Elektronika", "Bryły"].map((c) => (
              <button
                className={category === c ? "active" : ""}
                key={c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          {!items.length && (
            <div className="catalog-empty" role="status">
              <p>Brak pasujących elementów.</p>
              <button className="text-button" onClick={() => {
                setSearch("");
                setCategory("Wszystko");
              }}>Wyczyść filtry</button>
            </div>
          )}
          <div className="catalog-grid">
            {items.map((item) => (
              <button
                className="catalog-card"
                key={item.id}
                onClick={() => state.add(item.id as Exclude<Template, "mesh">)}
              >
                <div>
                  <Glyph template={item.id} color={item.color} />
                  <Plus size={14} />
                </div>
                <strong>{item.name}</strong>
                <span>
                  {item.role === "reference"
                    ? "Obrys orientacyjny"
                    : "Parametryczny CAD"}
                </span>
              </button>
            ))}
          </div>
          <button className="import-card" onClick={onImport}>
            <Upload size={18} />
            <strong>Własny element</strong>
            <span>Importuj STL lub GLB</span>
          </button>
        </>
      )}
    </aside>
  );
}
