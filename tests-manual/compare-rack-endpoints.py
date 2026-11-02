#!/usr/bin/env python3
"""Compare WireFlow SVG polyline endpoints to reference Visio candidates.

Usage: python tests-manual/compare-rack-endpoints.py inventory.json draft.svg x y width height tolerance
x/y/width/height specify the rack picture rectangle in Visio page inches (Y up).
Tolerance is in inches. Assumes the viewBox corresponds exactly to the rack picture
rectangle and contains no transforms. Diagnostic only; not electrical or route validation.
"""
import json
import math
import re
import statistics
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

COLORS = {'#e02020': 'red', '#00a651': 'green'}


def compare(data, svg_path, rectangle, tolerance):
    root = ET.parse(svg_path).getroot()
    view = root.get('viewBox', '').replace(',', ' ').split()
    if len(view) != 4:
        raise ValueError('SVG must have a four-number viewBox')
    vx, vy, vw, vh = map(float, view)
    x, y, width, height = rectangle
    if not all(math.isfinite(v) for v in (vx, vy, vw, vh, x, y, width, height, tolerance)) or min(vw, vh, width, height, tolerance) <= 0:
        raise ValueError('Rectangle, viewBox and tolerance must be finite and positive')
    if any(element.get('transform') for element in root.iter()):
        raise ValueError('SVG transforms are not supported')
    refs = data['reference']['1']['candidates']
    candidates = []
    for poly in root.iter('{http://www.w3.org/2000/svg}polyline'):
        color = COLORS.get(poly.get('stroke', '').lower())
        if not color:
            continue
        nums = [float(n) for n in re.findall(r'[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?', poly.get('points', ''))]
        if len(nums) < 4 or len(nums) % 2 or not all(math.isfinite(n) for n in nums):
            raise ValueError('Invalid polyline points')
        if poly.get('transform'):
            raise ValueError('Transformed polyline is not supported')
        def map_point(px, py):
            return [x + (px-vx)*width/vw, y + height - (py-vy)*height/vh]
        candidates.append({'color': color, 'begin': map_point(nums[0], nums[1]), 'end': map_point(nums[-2], nums[-1])})
    # One-to-one greedy closest pairing. This is deliberately reported as an
    # approximation and does not compare intermediate route geometry.
    pairs = []
    nearest = {color: [] for color in ("red", "green")}
    for i, got in enumerate(candidates):
        errors = []
        for j, ref in enumerate(refs):
            if got['color'] != ref['color']:
                continue
            def distance(a, b): return math.hypot(a[0]-b[0], a[1]-b[1])
            direct = max(distance(got['begin'], ref['begin']), distance(got['end'], ref['end']))
            reverse = max(distance(got['begin'], ref['end']), distance(got['end'], ref['begin']))
            error = min(direct, reverse)
            errors.append(error)
            if error <= tolerance:
                pairs.append((error, i, j))
        if errors:
            nearest[got["color"]].append(min(errors))
    used_got, used_ref = set(), set()
    for error, i, j in sorted(pairs):
        if i not in used_got and j not in used_ref:
            used_got.add(i); used_ref.add(j)
    return {'generated_polylines': len(candidates), 'reference_candidates': len(refs),
            'matched_endpoint_pairs': len(used_got), 'unmatched_generated': len(candidates)-len(used_got),
            'unmatched_reference': len(refs)-len(used_ref), 'tolerance_inches': tolerance,
            'nearest_endpoint_error_inches': {color: {'count': len(values), 'median': statistics.median(values), 'max': max(values)} if values else None for color, values in nearest.items()},
            'limitations': 'Endpoint/color candidates only; greedy pairing; nearest errors may reuse references; no route, component, polarity or electrical verification.'}


def main():
    if len(sys.argv) != 8:
        sys.exit(__doc__)
    inventory, svg = map(Path, sys.argv[1:3])
    numbers = list(map(float, sys.argv[3:]))
    print(json.dumps(compare(json.loads(inventory.read_text(encoding='utf-8')), svg, numbers[:4], numbers[4]), indent=2))

if __name__ == '__main__':
    main()
