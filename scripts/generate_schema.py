"""Pydantic is authoritative. Keep published schemas and the shared fixture in sync."""

import json
from pathlib import Path
from forma.domain import Operation, Project, pico_project

folder = Path("packages/schema")
for name, model in (("project", Project), ("operation", Operation)):
    (folder / f"{name}.schema.json").write_text(
        json.dumps(model.model_json_schema(), indent=2) + "\n"
    )
Path("samples/pico.forma.json").write_text(
    pico_project().model_dump_json(indent=2) + "\n"
)
