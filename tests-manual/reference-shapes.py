"""Extract top-level explicit red/green reference geometry as JSON.

Usage: python tests-manual/reference-shapes.py REFERENCE.vsdx OUTPUT.json
The result is reference data, not generated wiring or a netlist.
"""
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'v': 'http://schemas.microsoft.com/office/visio/2012/main'}

def extract(source):
    result = []
    with zipfile.ZipFile(source) as z:
        root = ET.fromstring(z.read('visio/pages/page1.xml'))
        for shape in root.find('v:Shapes', NS).findall('v:Shape', NS):
            cells = {c.get('N'): c.get('V') for c in shape.findall('v:Cell', NS)}
            if (cells.get('LineColor') or '').lower() not in ('#ff0000', '#00b050'):
                continue
            sections = []
            for section in shape.findall('v:Section', NS):
                if section.get('N') != 'Geometry':
                    continue
                rows = []
                for row in section.findall('v:Row', NS):
                    rows.append({'tag': 'Row', 'attrs': {'T': row.get('T', '')},
                        'children': [{'tag': 'Cell', 'attrs': {'N': c.get('N'), 'V': c.get('V', '')},
                                      'children': []} for c in row.findall('v:Cell', NS)]})
                sections.append({'tag': 'Section', 'attrs': {}, 'children': rows})
            result.append({'id': shape.get('ID'), 'cells': cells, 'sections': sections})
    return result

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    source, output = map(Path, sys.argv[1:])
    if source.resolve() == output.resolve():
        sys.exit('Output cannot overwrite the reference')
    shapes = extract(source)
    output.write_text(json.dumps(shapes), encoding='utf-8')
    print('Reference geometry shapes:', len(shapes))
