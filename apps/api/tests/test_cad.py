import io
import zipfile
from xml.etree import ElementTree as ET
from collections import Counter
import cadquery as cq
import pytest
from forma.cad import arrange, export_project, local_shape, placed_shape
from forma.domain import Project, Transform, create_part, pico_project


@pytest.mark.parametrize(
    "part", [p for p in pico_project().parts if p.role == "print"], ids=lambda p: p.id
)
def test_printable_breps_are_valid_single_solids(part):
    shape = local_shape(part)
    assert shape.isValid() and len(shape.Solids()) == 1 and shape.Volume() > 0
    assert shape.BoundingBox().zmin == pytest.approx(0, abs=1e-6)


def test_enclosure_has_expected_envelope_and_cavity():
    part = create_part("enclosure")
    shape = local_shape(part)
    b = shape.BoundingBox()
    assert (b.xlen, b.ylen, b.zlen) == pytest.approx((80, 60, 35))
    center = cq.Vector(0, 0, 20)
    assert not shape.isInside(center)
    assert shape.isInside(cq.Vector(0, 0, 1))


def test_step_roundtrip_preserves_volume(tmp_path):
    project = pico_project()
    content = export_project(project, ["pico-base"], "step")
    path = tmp_path / "base.step"
    path.write_bytes(content)
    imported = cq.importers.importStep(str(path)).val()
    assert imported.isValid()
    assert imported.Volume() == pytest.approx(
        local_shape(project.parts[0]).Volume(), rel=1e-7
    )


def test_3mf_contains_individual_objects_and_no_slicer_pretence():
    p = pico_project()
    parts = [x for x in p.parts if x.role == "print"]
    data = export_project(p, [x.id for x in parts], "3mf")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert set(z.namelist()) == {
            "[Content_Types].xml",
            "_rels/.rels",
            "3D/3dmodel.model",
        }
        model = ET.fromstring(z.read("3D/3dmodel.model"))
    ns = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
    assert model.attrib["unit"] == "millimeter"
    objects = model.findall("m:resources/m:object", ns)
    assert len(objects) == 4
    for obj in objects:
        verts = obj.findall("m:mesh/m:vertices/m:vertex", ns)
        assert min(float(v.attrib["z"]) for v in verts) == pytest.approx(0, abs=1e-5)
        assert all(
            0 <= float(v.attrib["x"]) <= 250 and 0 <= float(v.attrib["y"]) <= 250
            for v in verts
        )
        for tri in obj.findall("m:mesh/m:triangles/m:triangle", ns):
            assert all(
                0 <= int(tri.attrib[key]) < len(verts) for key in ("v1", "v2", "v3")
            )
        edges = Counter()
        for tri in obj.findall("m:mesh/m:triangles/m:triangle", ns):
            a, b, c = (int(tri.attrib[key]) for key in ("v1", "v2", "v3"))
            for edge in ((a, b), (b, c), (c, a)):
                edges[tuple(sorted(edge))] += 1
        assert set(edges.values()) == {2}, (
            "Exported shell must have shared, closed topology"
        )


def test_reference_electronics_and_oversized_print_rejected():
    p = pico_project()
    with pytest.raises(ValueError):
        export_project(p, ["pico-board"], "stl")
    with pytest.raises(ValueError):
        export_project(p, ["pico-base"], "3mf", bed=(50, 50, 50))


def test_rotation_translation_and_uniform_scale():
    part = create_part(
        "box", transform=Transform(position=(15, 30, 7), rotation=(0, 0, 90), scale=2)
    )
    part.params.update(width=20, depth=30, height=10)
    shape = placed_shape(Project(parts=[part]), part)
    b = shape.BoundingBox()
    assert (b.xlen, b.ylen, b.zlen, b.zmin) == pytest.approx((60, 40, 20, 7))
