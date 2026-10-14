"""Native B-rep generation. Mesh files never pretend to be editable CAD."""

from __future__ import annotations
import io
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
import cadquery as cq
from .domain import Part, Project, resolved_params


def rounded(w, d, h, r):
    obj = cq.Workplane("XY").rect(w, d).extrude(h)
    return obj.edges("|Z").fillet(r) if r > 0.001 else obj


def local_shape(part: Part, params: dict | None = None) -> cq.Shape:
    p = params or part.params
    kind = part.template
    if kind == "mesh":
        raise ValueError(
            "Siatka nie ma parametrycznej bryły CAD. Eksportuj jej oryginalny plik."
        )
    if kind == "cylinder":
        result = cq.Workplane("XY").circle(p["diameter"] / 2).extrude(p["height"])
        if p["holeDiameter"] > 0:
            result = result.cut(
                cq.Workplane("XY").circle(p["holeDiameter"] / 2).extrude(p["height"])
            )
    elif kind == "head":
        w, d, h, t, r = (p[k] for k in ("width", "depth", "height", "wall", "radius"))
        result = rounded(w, h, d, r).translate((0, 0, -d / 2))
        inner = rounded(w - 2 * t, h - 2 * t, d - t + 0.01, max(r - t, 0)).translate(
            (0, 0, -d / 2 + t)
        )
        window = rounded(
            p["windowWidth"],
            p["windowHeight"],
            t + 0.02,
            min(4, p["windowWidth"] / 4, p["windowHeight"] / 4),
        ).translate((0, 0, -d / 2 - 0.01))
        result = (
            result.cut(inner)
            .cut(window)
            .rotate((0, 0, 0), (1, 0, 0), -90)
            .translate((0, 0, h / 2))
        )
    else:
        w, d, h = (p[k] for k in ("width", "depth", "height"))
        result = rounded(w, d, h, p.get("radius", 0))
        if kind == "enclosure":
            t, r = p["wall"], p["radius"]
            inner = rounded(
                w - 2 * t, d - 2 * t, h - t + 0.01, max(r - t, 0)
            ).translate((0, 0, t))
            result = result.cut(inner)
        elif kind == "plate" and p["holeDiameter"] > 0:
            x, y = w / 2 - p["holeInset"], d / 2 - p["holeInset"]
            holes = (
                cq.Workplane("XY")
                .pushPoints([(-x, -y), (-x, y), (x, -y), (x, y)])
                .circle(p["holeDiameter"] / 2)
                .extrude(h)
            )
            result = result.cut(holes)
    shape = result.val()
    if not shape.isValid() or shape.Volume() <= 0:
        raise ValueError("Operacja nie utworzyła poprawnej bryły")
    return shape


def placed_shape(project: Project, part: Part) -> cq.Shape:
    shape = local_shape(part, resolved_params(project, part)).scale(
        part.transform.scale
    )
    for axis, angle in zip(((1, 0, 0), (0, 1, 0), (0, 0, 1)), part.transform.rotation):
        shape = shape.rotate((0, 0, 0), axis, angle)
    return shape.translate(part.transform.position)


def mesh_data(shape: cq.Shape):
    vertices, triangles = shape.tessellate(0.15, 0.12)
    # OCCT emits face-local vertices. Weld coincident vertices before 3MF export
    # so adjacent faces share actual topology instead of only matching positions.
    unique, lookup, remap = [], {}, []
    for v in vertices:
        point = tuple(round(x, 6) for x in (v.x, v.y, v.z))
        if point not in lookup:
            lookup[point] = len(unique)
            unique.append(list(point))
        remap.append(lookup[point])
    faces = []
    for triangle in triangles:
        mapped = [remap[i] for i in triangle]
        if len(set(mapped)) == 3:
            faces.append(mapped)
    return {"vertices": unique, "triangles": faces}


def preview(project: Project, part: Part):
    shape = local_shape(part, resolved_params(project, part))
    bb = shape.BoundingBox()
    return {
        **mesh_data(shape),
        "volume_mm3": shape.Volume(),
        "bounds_mm": [bb.xlen, bb.ylen, bb.zlen],
        "valid": shape.isValid(),
    }


def arrange(shapes: list[tuple[Part, cq.Shape]], bed: tuple[float, float, float]):
    out = []
    x, y, row = 5.0, 5.0, 0.0
    for part, shape in shapes:
        b = shape.BoundingBox()
        if x + b.xlen + 5 > bed[0]:
            x, y, row = 5, y + row + 5, 0
        if y + b.ylen + 5 > bed[1] or b.xlen + 10 > bed[0] or b.zlen > bed[2]:
            raise ValueError(
                "Części nie mieszczą się na podanej płycie. Eksportuj mniej części lub zmień jej wymiary."
            )
        out.append((part, shape.translate((x - b.xmin, y - b.ymin, -b.zmin))))
        x += b.xlen + 5
        row = max(row, b.ylen)
    return out


def make_3mf(shapes: list[tuple[Part, cq.Shape]]) -> bytes:
    ns = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
    ET.register_namespace("", ns)
    tag = lambda name: f"{{{ns}}}{name}"
    model = ET.Element(
        tag("model"),
        {"unit": "millimeter", "{http://www.w3.org/XML/1998/namespace}lang": "pl-PL"},
    )
    ET.SubElement(
        model, tag("metadata"), {"name": "Application"}
    ).text = "FORMA Studio 0.1 — geometry only, unsliced"
    resources = ET.SubElement(model, tag("resources"))
    materials = ET.SubElement(resources, tag("basematerials"), {"id": "1"})
    build = ET.SubElement(model, tag("build"))
    for i, (part, shape) in enumerate(shapes):
        ET.SubElement(
            materials,
            tag("base"),
            {"name": part.name, "displaycolor": part.color.upper() + "FF"},
        )
        obj = ET.SubElement(
            resources,
            tag("object"),
            {
                "id": str(i + 2),
                "type": "model",
                "name": part.name,
                "pid": "1",
                "pindex": str(i),
            },
        )
        mesh = ET.SubElement(obj, tag("mesh"))
        vertices = ET.SubElement(mesh, tag("vertices"))
        triangles = ET.SubElement(mesh, tag("triangles"))
        data = mesh_data(shape)
        for v in data["vertices"]:
            ET.SubElement(
                vertices,
                tag("vertex"),
                dict(zip(("x", "y", "z"), (f"{a:.6f}" for a in v))),
            )
        for a, b, c in data["triangles"]:
            ET.SubElement(
                triangles, tag("triangle"), {"v1": str(a), "v2": str(b), "v3": str(c)}
            )
        ET.SubElement(build, tag("item"), {"objectid": str(i + 2)})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
        )
        z.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
        )
        z.writestr(
            "3D/3dmodel.model",
            ET.tostring(model, encoding="utf-8", xml_declaration=True),
        )
    return buf.getvalue()


def export_project(
    project: Project,
    part_ids: list[str],
    fmt: str,
    layout="plate",
    bed=(250.0, 250.0, 250.0),
) -> bytes:
    parts = [p for p in project.parts if p.id in part_ids]
    if len(parts) != len(set(part_ids)) or not parts:
        raise ValueError("Wybierz istniejące części do eksportu")
    if any(p.role != "print" for p in parts):
        raise ValueError("Elektronika referencyjna nie jest częścią do wydrukowania")
    if any(p.template == "mesh" for p in parts):
        raise ValueError(
            "W tej wersji eksport CAD obejmuje części parametryczne. Importowaną siatkę pobierz jako plik źródłowy."
        )
    shapes = [(p, placed_shape(project, p)) for p in parts]
    if layout == "plate":
        shapes = arrange(shapes, bed)
    if fmt == "3mf":
        return make_3mf(shapes)
    combined = cq.Compound.makeCompound([s for _, s in shapes])
    with tempfile.TemporaryDirectory() as folder:
        dest = Path(folder) / f"model.{fmt}"
        cq.exporters.export(
            combined,
            str(dest),
            exportType="STEP" if fmt == "step" else "STL",
            tolerance=0.1,
            angularTolerance=0.1,
        )
        return dest.read_bytes()
