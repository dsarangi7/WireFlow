#!/usr/bin/env python3
"""Inventory reference drawing line candidates; this is not an electrical netlist.

Usage: python tests-manual/reference-wire-inventory.py INPUT.vsdx REFERENCE.vsdx OUTPUT.json
Only top-level page shapes with explicit red/green LineColor and finite Begin/End
coordinates are recorded. Coordinates are Visio page inches (Y increases up).
"""
import collections
import json
import math
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'v': 'http://schemas.microsoft.com/office/visio/2012/main'}
COLORS = {'#ff0000': 'red', '#00b050': 'green'}


def pages(path):
    with zipfile.ZipFile(path) as archive:
        result = {}
        for number in (1, 2):
            root = ET.fromstring(archive.read('visio/pages/page%d.xml' % number))
            container = root.find('v:Shapes', NS)
            entries, omitted = [], collections.Counter()
            for shape in container.findall('v:Shape', NS):
                cells = {c.get('N'): c.get('V') for c in shape.findall('v:Cell', NS)}
                color = COLORS.get((cells.get('LineColor') or '').lower())
                if not color:
                    continue
                try:
                    coords = [float(cells[k]) for k in ('BeginX', 'BeginY', 'EndX', 'EndY')]
                    if not all(math.isfinite(x) for x in coords):
                        raise ValueError('non-finite')
                except (KeyError, ValueError, TypeError):
                    omitted[color] += 1
                    continue
                row_types = [r.get('T') for section in shape.findall('v:Section', NS)
                             if section.get('N') == 'Geometry' for r in section.findall('v:Row', NS)]
                entries.append({'shape_id': shape.get('ID'), 'color': color,
                    'begin': coords[:2], 'end': coords[2:], 'geometry_rows': row_types})
            result[str(number)] = {'candidates': entries, 'omitted_without_endpoints': dict(omitted)}
        return result


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    input_path, reference_path, output_path = map(Path, sys.argv[1:])
    if output_path.resolve() in (input_path.resolve(), reference_path.resolve()):
        sys.exit('Output must not replace either source drawing.')
    data = {'description': 'Explicit-color shape candidates, not verified wires or connections.',
            'coordinates': 'Visio page inches, Y up',
            'input': pages(input_path), 'reference': pages(reference_path)}
    output_path.write_text(json.dumps(data, indent=2), encoding='utf-8')
    for kind in ('input', 'reference'):
        for number, page in data[kind].items():
            print(kind, 'page', number, 'candidates', len(page['candidates']),
                  'omitted', page['omitted_without_endpoints'])


if __name__ == '__main__':
    main()
