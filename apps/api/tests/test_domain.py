import pytest
from forma.domain import (
    Operation,
    Project,
    Transform,
    apply_operations,
    create_part,
    pico_project,
    resolved_params,
)


def test_pico_document_roundtrip():
    doc = pico_project()
    assert Project.model_validate_json(doc.model_dump_json()) == doc
    assert len(doc.parts) == 7


def test_linked_enclosure_tracks_reference_and_freezes_when_removed():
    board = create_part("pca9685")
    box = create_part("enclosure", fit_to=board.id)
    doc = Project(parts=[board, box])
    before = resolved_params(doc, box)
    new = apply_operations(
        doc,
        [Operation(type="update", part_id=board.id, patch={"params": {"width": 70}})],
    )
    after = resolved_params(new, next(p for p in new.parts if p.id == box.id))
    assert after["width"] == pytest.approx(before["width"] + 10)
    deleted = apply_operations(new, [Operation(type="remove", part_id=board.id)])
    assert deleted.parts[0].fit_to is None
    assert deleted.parts[0].params == after


def test_invalid_batch_is_atomic():
    doc = pico_project()
    with pytest.raises(ValueError):
        apply_operations(
            doc,
            [
                Operation(
                    type="update", part_id="pico-base", patch={"color": "#123456"}
                ),
                Operation(
                    type="update", part_id="pico-base", patch={"params": {"wall": 100}}
                ),
            ],
        )
    assert doc.parts[0].color == "#dddcd4"
    assert doc.revision == 0


def test_cycles_and_missing_references_rejected():
    a, b = create_part("enclosure"), create_part("enclosure")
    a.fit_to = b.id
    b.fit_to = a.id
    with pytest.raises(ValueError):
        Project(parts=[a, b])
    with pytest.raises(ValueError):
        Project(parts=[create_part("enclosure", fit_to="missing")])


def test_reference_rotation_cannot_silently_break_fit():
    board = create_part("pca9685")
    box = create_part("enclosure", fit_to=board.id)
    doc = Project(parts=[board, box])
    with pytest.raises(ValueError):
        apply_operations(
            doc,
            [
                Operation(
                    type="update",
                    part_id=board.id,
                    patch={"transform": {"rotation": [0, 0, 90]}},
                )
            ],
        )


def test_extra_fields_and_nonfinite_values_rejected():
    raw = pico_project().model_dump()
    raw["parts"][0]["params"]["width"] = float("nan")
    with pytest.raises(ValueError):
        Project.model_validate(raw)
    with pytest.raises(ValueError):
        apply_operations(
            pico_project(),
            [
                Operation(
                    type="update", part_id="pico-base", patch={"role": "reference"}
                )
            ],
        )
