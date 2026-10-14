import catalogData from "../../../packages/schema/catalog.json";
import demoData from "../../../samples/pico.forma.json";

export type Template =
  | "enclosure"
  | "head"
  | "plate"
  | "box"
  | "cylinder"
  | "cores3"
  | "sg90"
  | "pca9685"
  | "mesh";
export type Vec3 = [number, number, number];
export interface Part {
  id: string;
  name: string;
  template: Template;
  role: "print" | "reference";
  color: string;
  visible: boolean;
  params: Record<string, number>;
  transform: { position: Vec3; rotation: Vec3; scale: number };
  asset_id: string | null;
  fit_to: string | null;
  clearance: number;
  group: "base" | "neck" | "head" | "free";
}
export interface Project {
  schema_version: 1;
  id: string;
  name: string;
  units: "mm";
  revision: number;
  parts: Part[];
}
export interface CatalogItem {
  id: Exclude<Template, "mesh">;
  name: string;
  category: string;
  description: string;
  role: Part["role"];
  color: string;
  params: Record<string, number>;
}
export type Operation = {
  type: "add" | "update" | "remove";
  part_id?: string | null;
  part?: Part | null;
  patch?: Record<string, unknown>;
};
export interface Asset {
  id: string;
  name: string;
  url: string;
  mime: string;
  size: number;
  metadata: Record<string, unknown>;
}
// JSON sources are shared with Python and covered by the cross-runtime fixture tests.
export const catalog = catalogData as unknown as CatalogItem[];
export const demo = demoData as unknown as Project;
export const labels: Record<string, string> = {
  width: "Szerokość",
  depth: "Głębokość",
  height: "Wysokość",
  wall: "Ścianka",
  radius: "Promień narożnika",
  diameter: "Średnica",
  windowWidth: "Szerokość okna",
  windowHeight: "Wysokość okna",
  holeDiameter: "Średnica otworu",
  holeInset: "Odsunięcie otworów",
};
export const colors = [
  "#dddcd4",
  "#839787",
  "#e7a86b",
  "#4474a5",
  "#c56c61",
  "#242e32",
];

export function createPart(template: Exclude<Template, "mesh">): Part {
  const item = catalog.find((c) => c.id === template)!;
  return {
    id: crypto.randomUUID(),
    name: item.name,
    template,
    role: item.role,
    color: item.color,
    visible: true,
    params: { ...item.params },
    transform: { position: [80, 0, 0], rotation: [0, 0, 0], scale: 1 },
    asset_id: null,
    fit_to: null,
    clearance: 0.4,
    group: "free",
  };
}
export function dimensions(p: Part, params = p.params): Vec3 {
  return [
    params.width ?? params.diameter ?? 20,
    params.depth ?? params.diameter ?? 20,
    params.height ?? 20,
  ];
}
export function resolvedParams(
  project: Project,
  part: Part,
  seen = new Set<string>(),
): Record<string, number> {
  const result = { ...part.params };
  if (part.fit_to) {
    if (seen.has(part.id)) throw new Error("Cykl zależności części");
    seen.add(part.id);
    const ref = project.parts.find((p) => p.id === part.fit_to);
    if (!ref) throw new Error("Brakuje części referencyjnej");
    if (
      ref.template === "mesh" ||
      ref.transform.rotation.some((x) => Math.abs(x) > 1e-8)
    )
      throw new Error(
        "Powiązana obudowa wymaga nieobróconej części parametrycznej",
      );
    const [w, d, h] = dimensions(ref, resolvedParams(project, ref, seen)).map(
      (x) => x * ref.transform.scale,
    );
    result.width = w + 2 * (result.wall + part.clearance);
    result.depth = d + 2 * (result.wall + part.clearance);
    result.height = h + result.wall + part.clearance;
    result.radius = Math.min(
      result.radius,
      Math.min(result.width, result.depth) / 2 - 0.1,
    );
  }
  return result;
}
export function validateProject(value: unknown): Project {
  const p = structuredClone(value) as Project;
  if (
    !p ||
    p.schema_version !== 1 ||
    p.units !== "mm" ||
    !Array.isArray(p.parts) ||
    p.parts.length > 200 ||
    !p.name?.trim() ||
    p.name.length > 100 ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(p.id) ||
    !Number.isInteger(p.revision) ||
    p.revision < 0
  )
    throw new Error("Nieprawidłowy dokument FORMA v1");
  const ids = new Set<string>();
  for (const part of p.parts) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(part.id) || ids.has(part.id))
      throw new Error("Nieprawidłowe albo powtórzone ID części");
    ids.add(part.id);
    if (
      !part.name?.trim() ||
      part.name.length > 100 ||
      !/^#[0-9a-f]{6}$/i.test(part.color) ||
      !["print", "reference"].includes(part.role) ||
      typeof part.visible !== "boolean" ||
      !["base", "neck", "head", "free"].includes(part.group)
    )
      throw new Error("Nieprawidłowe właściwości części");
    if (
      !part.transform ||
      part.transform.scale < 0.001 ||
      part.transform.scale > 1000 ||
      !Number.isFinite(part.transform.scale)
    )
      throw new Error("Nieprawidłowa skala");
    for (const vector of [part.transform.position, part.transform.rotation])
      if (
        !Array.isArray(vector) ||
        vector.length !== 3 ||
        !vector.every(Number.isFinite)
      )
        throw new Error("Nieprawidłowa transformacja");
    if (part.transform.position.some((x) => Math.abs(x) > 10000))
      throw new Error("Pozycja poza zakresem ±10 000 mm");
    if (
      !Number.isFinite(part.clearance) ||
      part.clearance < 0 ||
      part.clearance > 20
    )
      throw new Error("Luz poza zakresem 0–20 mm");
    if (part.fit_to && part.template !== "enclosure")
      throw new Error("Powiązanie wymiarów wymaga obudowy");
    if (part.template === "mesh") {
      if (!part.asset_id) throw new Error("Siatka wymaga pliku źródłowego");
      continue;
    }
    const item = catalog.find((c) => c.id === part.template);
    if (!item) throw new Error("Nieznany rodzaj części");
    if (item.role === "reference" && part.role !== "reference")
      throw new Error("Elektronika jest częścią referencyjną");
    if (
      Object.keys(part.params).sort().join() !==
      Object.keys(item.params).sort().join()
    )
      throw new Error("Nieprawidłowe parametry części");
    if (
      Object.values(part.params).some(
        (x) => !Number.isFinite(x) || x < 0 || x > 1000,
      )
    )
      throw new Error("Parametry poza zakresem 0–1000 mm");
  }
  for (const part of p.parts) {
    if (part.template === "mesh") continue;
    const a = resolvedParams(p, part);
    for (const key of ["width", "depth", "height", "diameter"])
      if (key in a && a[key] < 0.1)
        throw new Error(`${labels[key]}: minimum 0,1 mm`);
    if (
      "radius" in a &&
      a.radius >=
        Math.min(a.width, part.template === "head" ? a.height : a.depth) / 2
    )
      throw new Error("Promień jest za duży dla tych wymiarów");
    if (
      "wall" in a &&
      (a.wall < 0.4 || 2 * a.wall >= Math.min(a.width, a.depth, a.height))
    )
      throw new Error("Ścianka musi mieć ≥0,4 mm i pozostawiać wnętrze");
    if (
      part.template === "head" &&
      Math.min(a.windowWidth, a.windowHeight) < 0.1
    )
      throw new Error("Wymiary okna muszą mieć co najmniej 0,1 mm");
    if (
      part.template === "head" &&
      (a.windowWidth >= a.width - 2 * a.wall ||
        a.windowHeight >= a.height - 2 * a.wall)
    )
      throw new Error("Okno musi pozostawiać ramkę obudowy");
    if (part.template === "cylinder" && a.holeDiameter >= a.diameter)
      throw new Error("Otwór musi być mniejszy od cylindra");
    if (
      part.template === "plate" &&
      a.holeDiameter > 0 &&
      (a.holeInset <= a.holeDiameter / 2 ||
        2 * (a.holeInset + a.holeDiameter / 2) >= Math.min(a.width, a.depth) ||
        a.holeInset < a.radius)
    )
      throw new Error("Otwory nie mieszczą się w płytce");
  }
  return p;
}
export function applyOperations(
  project: Project,
  operations: Operation[],
): Project {
  const next = structuredClone(project);
  for (const op of operations) {
    const index = next.parts.findIndex((p) => p.id === op.part_id);
    if (op.type === "add") {
      if (!op.part) throw new Error("Brak części");
      next.parts.push(structuredClone(op.part));
    } else if (op.type === "remove") {
      if (index < 0) throw new Error("Nie znaleziono części");
      for (const p of next.parts)
        if (p.fit_to === op.part_id) {
          p.params = resolvedParams(next, p);
          p.fit_to = null;
        }
      next.parts.splice(index, 1);
    } else {
      if (index < 0) throw new Error("Nie znaleziono części");
      const old = next.parts[index],
        patch = op.patch ?? {};
      const allowed = [
        "name",
        "color",
        "visible",
        "params",
        "transform",
        "fit_to",
        "clearance",
        "group",
      ];
      if (Object.keys(patch).some((k) => !allowed.includes(k)))
        throw new Error("Niedozwolona zmiana");
      next.parts[index] = {
        ...old,
        ...patch,
        params: { ...old.params, ...(patch.params as object) },
        transform: { ...old.transform, ...(patch.transform as object) },
      } as Part;
    }
  }
  next.revision = project.revision + 1;
  return validateProject(next);
}
export function signature(project: Project, part: Part) {
  return JSON.stringify([part.template, resolvedParams(project, part)]);
}
