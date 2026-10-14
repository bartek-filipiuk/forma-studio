import { describe, it, expect } from "vitest";
import {
  applyOperations,
  createPart,
  demo,
  resolvedParams,
  validateProject,
} from "./domain";
import { useStudio } from "./store";
describe("document contract and editing", () => {
  it("accepts the real Python-generated PICO document", () => {
    expect(validateProject(demo).parts).toHaveLength(7);
  });
  it("updates dependent enclosure dimensions and freezes them on reference removal", () => {
    const board = createPart("pca9685"),
      box = createPart("enclosure");
    box.fit_to = board.id;
    const p = { ...demo, parts: [board, box] };
    const a = resolvedParams(p, box);
    const next = applyOperations(p, [
      { type: "update", part_id: board.id, patch: { params: { width: 70 } } },
    ]);
    const b = resolvedParams(next, next.parts[1]);
    expect(b.width - a.width).toBe(10);
    const deleted = applyOperations(next, [
      { type: "remove", part_id: board.id },
    ]);
    expect(deleted.parts[0].fit_to).toBe(null);
    expect(deleted.parts[0].params).toEqual(b);
  });
  it("rejects an invalid batch atomically", () => {
    const before = JSON.stringify(demo);
    expect(() =>
      applyOperations(demo, [
        { type: "update", part_id: "pico-base", patch: { color: "#123456" } },
        {
          type: "update",
          part_id: "pico-base",
          patch: { params: { wall: 100 } },
        },
      ]),
    ).toThrow();
    expect(JSON.stringify(demo)).toBe(before);
  });
  it("does not accept missing references or cyclic documents", () => {
    const a = createPart("enclosure"),
      b = createPart("enclosure");
    a.fit_to = b.id;
    b.fit_to = a.id;
    expect(() => validateProject({ ...demo, parts: [a, b] })).toThrow();
    expect(() => validateProject({ ...demo, schema_version: 22 })).toThrow();
  });
  it("increments the revision on undo and redo to invalidate stale AI plans", () => {
    useStudio.getState().load(demo);
    useStudio.getState().update("pico-base", { params: { wall: 3 } });
    const editRevision = useStudio.getState().project.revision;
    useStudio.getState().undo();
    expect(useStudio.getState().project.parts[0].params.wall).toBe(2.4);
    expect(useStudio.getState().project.revision).toBeGreaterThan(editRevision);
    useStudio.getState().redo();
    expect(useStudio.getState().project.parts[0].params.wall).toBe(3);
    expect(useStudio.getState().project.revision).toBeGreaterThan(
      editRevision + 1,
    );
  });
});
