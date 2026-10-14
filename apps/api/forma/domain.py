from __future__ import annotations
import json
import math
import re
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4
from pydantic import BaseModel, ConfigDict, Field, model_validator

ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads((ROOT / "packages/schema/catalog.json").read_text())
TEMPLATES = {item["id"]: item for item in CATALOG}
Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
Template = Literal[
    "enclosure", "head", "plate", "box", "cylinder", "cores3", "sg90", "pca9685", "mesh"
]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Transform(Model):
    position: tuple[float, float, float] = (0, 0, 0)
    rotation: tuple[float, float, float] = (0, 0, 0)  # degrees; intrinsic XYZ
    scale: float = Field(default=1, ge=0.001, le=1000)

    @model_validator(mode="after")
    def limits(self):
        if any(abs(x) > 10000 for x in self.position):
            raise ValueError("Pozycja poza zakresem ±10 000 mm")
        return self


class Part(Model):
    id: Identifier = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(min_length=1, max_length=100)
    template: Template
    role: Literal["print", "reference"] = "print"
    color: str = Field(default="#dddcd4", pattern=r"^#[0-9a-fA-F]{6}$")
    visible: bool = True
    params: dict[str, float] = Field(default_factory=dict)
    transform: Transform = Field(default_factory=Transform)
    asset_id: Identifier | None = None
    fit_to: Identifier | None = None
    clearance: float = Field(default=0.4, ge=0, le=20)
    group: Literal["base", "neck", "head", "free"] = "free"

    @model_validator(mode="after")
    def geometry(self):
        if self.template == "mesh":
            if not self.asset_id:
                raise ValueError("Importowana siatka wymaga asset_id")
            return self
        defaults = TEMPLATES[self.template]["params"]
        if set(self.params) != set(defaults):
            raise ValueError("Nieprawidłowy zestaw parametrów części")
        for key, value in self.params.items():
            if not math.isfinite(value) or value < 0 or value > 1000:
                raise ValueError(f"Parametr {key} poza zakresem 0–1000 mm")
        validate_dimensions(self.template, self.params)
        if self.fit_to and self.template != "enclosure":
            raise ValueError("Powiązanie wymiarów obsługują obudowy otwarte")
        if self.template in ("cores3", "sg90", "pca9685") and self.role != "reference":
            raise ValueError("Elektronika jest elementem referencyjnym")
        return self


def validate_dimensions(template: str, p: dict[str, float]):
    for key in ("width", "depth", "height", "diameter"):
        if key in p and p[key] < 0.1:
            raise ValueError(f"{key}: minimum 0,1 mm")
    if (
        "radius" in p
        and p["radius"]
        >= min(p["width"], p["depth"] if template != "head" else p["height"]) / 2
    ):
        raise ValueError("Promień musi być mniejszy od połowy krótszego boku")
    if "wall" in p:
        if p["wall"] < 0.4 or p["wall"] * 2 >= min(p["width"], p["depth"], p["height"]):
            raise ValueError("Ścianka musi mieć ≥0,4 mm i pozostawiać wnętrze obudowy")
    if template == "head":
        if min(p["windowWidth"], p["windowHeight"]) < 0.1:
            raise ValueError("Wymiary okna muszą mieć co najmniej 0,1 mm")
        if (
            p["windowWidth"] >= p["width"] - 2 * p["wall"]
            or p["windowHeight"] >= p["height"] - 2 * p["wall"]
        ):
            raise ValueError("Okno musi pozostawiać ramkę obudowy")
    if template == "cylinder" and p["holeDiameter"] >= p["diameter"]:
        raise ValueError("Otwór musi być mniejszy od cylindra")
    if template == "plate" and p["holeDiameter"] > 0:
        inset, radius = p["holeInset"], p["holeDiameter"] / 2
        if (
            inset <= radius
            or 2 * (inset + radius) >= min(p["width"], p["depth"])
            or inset < p["radius"]
        ):
            raise ValueError("Otwory muszą mieścić się w płytce, poza zaokrągleniami")


class Project(Model):
    schema_version: Literal[1] = 1
    id: Identifier = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(default="Mój projekt", min_length=1, max_length=100)
    units: Literal["mm"] = "mm"
    revision: int = Field(default=0, ge=0)
    parts: list[Part] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def links(self):
        ids = [p.id for p in self.parts]
        if len(ids) != len(set(ids)):
            raise ValueError("Identyfikatory części muszą być unikalne")
        for part in self.parts:
            seen = {part.id}
            target = part.fit_to
            while target:
                if target not in ids or target in seen:
                    raise ValueError("Brak części referencyjnej lub cykl zależności")
                seen.add(target)
                target = next(p for p in self.parts if p.id == target).fit_to
        for part in self.parts:
            if part.fit_to:
                validate_dimensions(part.template, resolved_params(self, part))
        return self


class Operation(Model):
    type: Literal["add", "update", "remove"]
    part_id: Identifier | None = None
    part: Part | None = None
    patch: dict = Field(default_factory=dict)


def dimensions(part: Part, params: dict | None = None):
    p = params or part.params
    return (
        p.get("width", p.get("diameter", 20)),
        p.get("depth", p.get("diameter", 20)),
        p.get("height", 20),
    )


def resolved_params(project: Project, part: Part) -> dict[str, float]:
    result = dict(part.params)
    if part.fit_to:
        ref = next(p for p in project.parts if p.id == part.fit_to)
        if ref.template == "mesh" or any(abs(x) > 1e-8 for x in ref.transform.rotation):
            raise ValueError(
                "Automatyczna obudowa wymaga nieobróconej części parametrycznej"
            )
        w, d, h = (
            x * ref.transform.scale
            for x in dimensions(ref, resolved_params(project, ref))
        )
        wall, gap = result["wall"], part.clearance
        result.update(
            width=w + 2 * (wall + gap),
            depth=d + 2 * (wall + gap),
            height=h + wall + gap,
        )
        result["radius"] = min(
            result["radius"], min(result["width"], result["depth"]) / 2 - 0.1
        )
    return result


def apply_operations(project: Project, operations: list[Operation]) -> Project:
    # Apply atomically to a copy, validate the entire final dependency graph.
    raw = project.model_dump(mode="json")
    for op in operations:
        index = next(
            (i for i, p in enumerate(raw["parts"]) if p["id"] == op.part_id), None
        )
        if op.type == "add":
            if op.part is None:
                raise ValueError("Brak dodawanej części")
            raw["parts"].append(op.part.model_dump(mode="json"))
        elif op.type == "remove":
            if index is None:
                raise ValueError("Nie znaleziono części")
            current = Project.model_validate(raw)
            for p in raw["parts"]:
                if p["fit_to"] == op.part_id:
                    p["params"] = resolved_params(
                        current, next(x for x in current.parts if x.id == p["id"])
                    )
                    p["fit_to"] = None
            raw["parts"].pop(index)
        else:
            if index is None:
                raise ValueError("Nie znaleziono części")
            if set(op.patch) - {
                "name",
                "color",
                "visible",
                "params",
                "transform",
                "fit_to",
                "clearance",
                "group",
            }:
                raise ValueError("Niedozwolone pole zmiany")
            part = raw["parts"][index]
            for key, value in op.patch.items():
                if key in ("params", "transform"):
                    part[key] = {**part[key], **value}
                else:
                    part[key] = value
    raw["revision"] += 1
    return Project.model_validate(raw)


def create_part(template: str, **kwargs) -> Part:
    entry = TEMPLATES[template]
    return Part(
        template=template,
        params=dict(entry["params"]),
        name=entry["name"],
        role=entry["role"],
        color=entry["color"],
        **kwargs,
    )


def pico_project() -> Project:
    # Editable exploration from envelope dimensions in PICO_CUTE_v1_instrukcja.pdf.
    # This is NOT a mechanical reproduction of the seven-part OpenSCAD assembly.
    base = create_part("enclosure", id="pico-base", group="base")
    base.name = "Korpus podstawy"
    base.params.update(width=110, depth=92, height=52, radius=14)
    lid = create_part(
        "plate", id="pico-deck", group="base", transform=Transform(position=(0, 0, 53))
    )
    lid.name = "Pokrywa podstawy"
    neck = create_part(
        "cylinder",
        id="pico-neck",
        group="neck",
        transform=Transform(position=(0, 0, 57)),
    )
    neck.name = "Szyja · szkic"
    neck.params.update(diameter=27, height=22, holeDiameter=8)
    head = create_part(
        "head", id="pico-head", group="head", transform=Transform(position=(0, 0, 81))
    )
    core = create_part(
        "cores3",
        id="pico-screen",
        group="head",
        transform=Transform(position=(0, -6, 95)),
    )
    board = create_part(
        "pca9685",
        id="pico-board",
        group="base",
        transform=Transform(position=(0, 9, 5)),
    )
    servo = create_part(
        "sg90",
        id="pico-servo",
        group="base",
        transform=Transform(position=(0, -18, 24)),
    )
    return Project(
        id="pico-workbench",
        name="PICO · robot biurkowy",
        parts=[base, lid, neck, head, core, board, servo],
    )
