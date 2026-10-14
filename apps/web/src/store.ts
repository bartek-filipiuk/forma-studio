import { create } from "zustand";
import {
  applyOperations,
  createPart,
  demo,
  resolvedParams,
  validateProject,
} from "./domain";
import type { Operation, Project, Template } from "./domain";
const cacheKey = "forma.studio.v1";
function initial() {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
    if (raw)
      return {
        project: validateProject(raw.project),
        serverVersion: raw.serverVersion as number | null,
        savedRevision: Number.isInteger(raw.savedRevision) ? raw.savedRevision : -1,
      };
  } catch {
    /* Never import an invalid document into the scene. */
  }
  return {
    project: { ...structuredClone(demo), id: crypto.randomUUID() },
    serverVersion: null,
    savedRevision: -1,
  };
}
function persist(project: Project, serverVersion: number | null, savedRevision: number) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ project, serverVersion, savedRevision }));
  } catch {
    /* Manual JSON export remains available. */
  }
}
type State = {
  project: Project;
  serverVersion: number | null;
  selectedId: string | null;
  past: Project[];
  future: Project[];
  savedRevision: number;
  toast: string | null;
  tool: "select" | "translate" | "rotate";
  showRefs: boolean;
  xray: boolean;
  showDimensions: boolean;
  explode: number;
  pan: number;
  tilt: number;
  frameTick: number;
  commit: (ops: Operation[]) => boolean;
  update: (id: string, patch: Record<string, unknown>) => boolean;
  select: (id: string | null) => void;
  add: (template: Exclude<Template, "mesh">) => void;
  duplicate: () => void;
  remove: () => void;
  enclose: () => void;
  undo: () => void;
  redo: () => void;
  load: (p: Project, version?: number | null) => void;
  markSaved: (version: number, revision: number) => void;
  rename: (name: string) => void;
  notify: (message: string) => void;
};
const seed = initial();
export const useStudio = create<State>((set, get) => ({
  ...seed,
  selectedId: seed.project.parts[0]?.id ?? null,
  past: [],
  future: [],
  toast: null,
  tool: "select",
  showRefs: true,
  xray: false,
  showDimensions: true,
  explode: 0,
  pan: 0,
  tilt: 0,
  frameTick: 0,
  commit: (ops) => {
    try {
      const state = get(),
        project = applyOperations(state.project, ops);
      set({
        project,
        past: [...state.past.slice(-39), state.project],
        future: [],
      });
      persist(project, state.serverVersion, state.savedRevision);
      return true;
    } catch (e) {
      get().notify((e as Error).message);
      return false;
    }
  },
  update: (id, patch) => get().commit([{ type: "update", part_id: id, patch }]),
  select: (id) => set({ selectedId: id }),
  add: (template) => {
    const p = createPart(template);
    if (get().commit([{ type: "add", part: p }]))
      set({ selectedId: p.id, toast: `Dodano: ${p.name}` });
  },
  duplicate: () => {
    const s = get(),
      part = s.project.parts.find((p) => p.id === s.selectedId);
    if (!part) return;
    const copy = structuredClone(part);
    copy.id = crypto.randomUUID();
    copy.name += " · kopia";
    copy.transform.position[0] += 30;
    if (s.commit([{ type: "add", part: copy }])) set({ selectedId: copy.id });
  },
  remove: () => {
    const s = get();
    if (s.selectedId && s.commit([{ type: "remove", part_id: s.selectedId }]))
      set({ selectedId: null });
  },
  enclose: () => {
    const s = get(),
      part = s.project.parts.find((p) => p.id === s.selectedId);
    if (!part || part.template === "mesh") return;
    const box = createPart("enclosure");
    box.name = `Obudowa · ${part.name}`;
    box.fit_to = part.id;
    box.transform.position = [
      part.transform.position[0],
      part.transform.position[1],
      part.transform.position[2] - box.params.wall - box.clearance,
    ];
    box.params = resolvedParams(
      { ...s.project, parts: [...s.project.parts, box] },
      box,
    );
    if (s.commit([{ type: "add", part: box }])) set({ selectedId: box.id });
  },
  undo: () => {
    const s = get(),
      prev = s.past.at(-1);
    if (!prev) return;
    const project = {
      ...structuredClone(prev),
      revision: s.project.revision + 1,
    };
    set({
      project,
      past: s.past.slice(0, -1),
      future: [s.project, ...s.future],
    });
    persist(project, s.serverVersion, s.savedRevision);
  },
  redo: () => {
    const s = get(),
      next = s.future[0];
    if (!next) return;
    const project = {
      ...structuredClone(next),
      revision: s.project.revision + 1,
    };
    set({ project, past: [...s.past, s.project], future: s.future.slice(1) });
    persist(project, s.serverVersion, s.savedRevision);
  },
  load: (p, version = null) => {
    try {
      const project = validateProject(p);
      set({
        project,
        serverVersion: version,
        savedRevision: version ? project.revision : -1,
        selectedId: project.parts[0]?.id ?? null,
        past: [],
        future: [],
        explode: 0,
        pan: 0,
        tilt: 0,
        frameTick: get().frameTick + 1,
      });
      persist(project, version, version ? project.revision : -1);
    } catch (e) {
      get().notify((e as Error).message);
    }
  },
  markSaved: (serverVersion, savedRevision) => {
    set({ serverVersion, savedRevision });
    persist(get().project, serverVersion, savedRevision);
  },
  rename: (name) => {
    if (!name.trim()) return;
    const s = get(),
      project = {
        ...s.project,
        name: name.slice(0, 100),
        revision: s.project.revision + 1,
      };
    set({ project, past: [...s.past.slice(-39), s.project], future: [] });
    persist(project, s.serverVersion, s.savedRevision);
  },
  notify: (toast) => set({ toast }),
}));
export const selectedPart = () => {
  const s = useStudio.getState();
  return s.project.parts.find((p) => p.id === s.selectedId);
};
