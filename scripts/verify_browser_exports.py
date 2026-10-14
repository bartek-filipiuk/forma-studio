"""Check the real downloads produced by the Playwright acceptance scenario.

Usage: python scripts/verify_browser_exports.py <acceptance-output-directory>
No slicer/profile compatibility or physical printability is implied.
"""

import json
import math
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET


def inspect(path, expected_names):
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        model = ET.fromstring(archive.read("3D/3dmodel.model"))
        assert set(archive.namelist()) == {
            "[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"
        }
    ns = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
    assert model.attrib["unit"] == "millimeter"
    objects = model.findall("m:resources/m:object", ns)
    assert {obj.attrib["name"] for obj in objects} == set(expected_names)
    assert len(model.findall("m:build/m:item", ns)) == len(objects)
    result = []
    for obj in objects:
        vertices = [
            tuple(float(v.attrib[k]) for k in ("x", "y", "z"))
            for v in obj.findall("m:mesh/m:vertices/m:vertex", ns)
        ]
        triangles = [
            tuple(int(t.attrib[k]) for k in ("v1", "v2", "v3"))
            for t in obj.findall("m:mesh/m:triangles/m:triangle", ns)
        ]
        assert vertices and triangles
        assert all(math.isfinite(c) for v in vertices for c in v)
        low = [min(v[i] for v in vertices) for i in range(3)]
        high = [max(v[i] for v in vertices) for i in range(3)]
        assert abs(low[2]) < 1e-5
        assert all(-1e-5 <= lo <= hi <= 250 + 1e-5 for lo, hi in zip(low, high))
        edges = Counter()
        volume = 0
        for a, b, c in triangles:
            assert len({a, b, c}) == 3
            assert all(0 <= i < len(vertices) for i in (a, b, c))
            for edge in ((a, b), (b, c), (c, a)):
                edges[edge] += 1
            u, v, w = vertices[a], vertices[b], vertices[c]
            volume += (
                u[0] * (v[1] * w[2] - v[2] * w[1])
                + u[1] * (v[2] * w[0] - v[0] * w[2])
                + u[2] * (v[0] * w[1] - v[1] * w[0])
            ) / 6
        assert all(count == 1 and edges[(b, a)] == 1 for (a, b), count in edges.items())
        assert volume > 0
        result.append({
            "name": obj.attrib["name"],
            "bounds_mm": [hi - lo for lo, hi in zip(low, high)],
            "volume_mm3": volume,
            "triangles": len(triangles),
        })
    return result


if __name__ == "__main__":
    folder = Path(sys.argv[1])
    project = json.loads((folder / "project.forma.json").read_text())
    preview = json.loads((folder / "preview.json").read_text())["result"]
    base = next(p for p in project["parts"] if p["id"] == "pico-base")
    single = inspect(folder / "base.3mf", [base["name"]])
    plate = inspect(folder / "plate.3mf", [p["name"] for p in project["parts"] if p["role"] == "print"])
    expected_bounds = [base["params"][k] for k in ("width", "depth", "height")]
    assert all(math.isclose(a, b, abs_tol=1e-5) for a, b in zip(single[0]["bounds_mm"], expected_bounds))
    assert math.isclose(single[0]["volume_mm3"], preview["volume_mm3"], rel_tol=0.002)
    print(json.dumps({"base": single, "plate": plate, "native_volume_mm3": preview["volume_mm3"], "sliced": False}, indent=2, ensure_ascii=False))
