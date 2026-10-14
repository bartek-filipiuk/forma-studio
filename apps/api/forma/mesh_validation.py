"""Bounded STL syntax checks at upload; no CAD, repair or printability claim."""

import math
import struct


def validate_stl(data: bytes | bytearray) -> None:
    def vector(tokens):
        if len(tokens) != 3:
            raise ValueError
        values = [float(v) for v in tokens]
        if not all(math.isfinite(v) and abs(v) <= 3.402823466e38 for v in values):
            raise ValueError

    try:
        if len(data) >= 84:
            count = struct.unpack_from("<I", data, 80)[0]
            if 84 + count * 50 == len(data):
                if count == 0:
                    raise ValueError
                for record in struct.iter_unpack("<12fH", memoryview(data)[84:]):
                    for offset in range(0, 12, 3):
                        vector(record[offset:offset + 3])
                return

        lines = iter(line.strip() for line in data.decode("utf-8-sig").splitlines() if line.strip())
        count = 0
        in_solid = False
        for line in lines:
            words = line.split()
            keyword = words[0].lower()
            if keyword == "solid" and not in_solid:
                in_solid = True
            elif keyword == "endsolid" and in_solid:
                in_solid = False
            elif keyword == "facet" and in_solid:
                if len(words) != 5 or words[1].lower() != "normal":
                    raise ValueError
                vector(words[2:])
                if next(lines).lower().split() != ["outer", "loop"]:
                    raise ValueError
                for _ in range(3):
                    vertex = next(lines).split()
                    if vertex[0].lower() != "vertex":
                        raise ValueError
                    vector(vertex[1:])
                if next(lines).lower() != "endloop" or next(lines).lower() != "endfacet":
                    raise ValueError
                count += 1
            else:
                raise ValueError
        if in_solid or count == 0:
            raise ValueError
    except (ValueError, StopIteration, UnicodeError, struct.error):
        raise ValueError("Nieprawidłowy STL: wybierz kompletną siatkę z trójkątami i skończonymi współrzędnymi.") from None
