"""Run from repository root with the API environment."""

from pathlib import Path
from forma.domain import pico_project
from forma.cad import export_project

folder = Path("samples/exports")
folder.mkdir(parents=True, exist_ok=True)
project = pico_project()
for fmt in ("stl", "step"):
    (folder / f"pico-base.{fmt}").write_bytes(
        export_project(project, ["pico-base"], fmt)
    )
(folder / "pico-workbench-unsliced.3mf").write_bytes(
    export_project(project, [p.id for p in project.parts if p.role == "print"], "3mf")
)
print("Sample CAD exports created; these are geometry-only, unsliced prototypes.")
