"""Count interior wire crossings in a WireFlow SVG; not an electrical validation.

Usage: python tests-manual/audit-svg-crossings.py DRAWING.svg
Counts distinct polyline pairs, not intersection points. Shared endpoints and
collinear overlaps are excluded and require separate review.
"""
import json
import sys
import xml.etree.ElementTree as ET
from itertools import combinations

COLORS = {'#e02020': 'power', '#00a651': 'communication'}


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def interior_cross(a, b, c, d):
    ab1, ab2 = cross(a, b, c), cross(a, b, d)
    cd1, cd2 = cross(c, d, a), cross(c, d, b)
    return ab1 * ab2 < -1e-9 and cd1 * cd2 < -1e-9


def audit(root):
    wires = []
    for e in root.iter():
        color = COLORS.get(e.get('stroke', '').lower())
        if e.tag.split('}')[-1] != 'polyline' or not color:
            continue
        points = [tuple(map(float, p.split(','))) for p in e.attrib['points'].split()]
        if len(points) < 2 or any(len(p) != 2 for p in points):
            raise ValueError('Invalid wire polyline')
        wires.append((color, list(zip(points, points[1:]))))
    counts = {'power/power': 0, 'power/communication': 0, 'communication/communication': 0}
    for (ca, a), (cb, b) in combinations(wires, 2):
        if any(interior_cross(*sa, *sb) for sa in a for sb in b):
            key = 'power/power' if ca == cb == 'power' else 'communication/communication' if ca == cb else 'power/communication'
            counts[key] += 1
    return {'wire_polylines': len(wires), 'crossing_wire_pairs': counts,
            'limitations': 'Interior straight-segment crossings only; excludes endpoint contacts, collinear overlaps and unrecognized SVG shapes/colors. No electrical validation.'}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Pass one WireFlow SVG path')
    print(json.dumps(audit(ET.parse(sys.argv[1]).getroot()), indent=2))
