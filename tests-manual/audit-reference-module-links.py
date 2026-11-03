"""Audit labelled module links in the supplied finished Visio reference.

Usage: python tests-manual/audit-reference-module-links.py REFERENCE.vsdx PORTS.json INVENTORY.json
Fixture-specific page/image transforms and nearest-neighbour matching. Port
labels come from visual candidates and user-confirmed left-to-right order.
Reference labels/line colors/proximity do not establish electrical approval.
"""
import json
import math
import re
import statistics
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'v': 'http://schemas.microsoft.com/office/visio/2012/main'}
RECT = (1.617195811466863, 5.361483135485282, 13.92472787730751, 5.1592174425)


def page_to_pixel(point):
    left, bottom, width, height = RECT
    return ((point[0]-left)/width*1155, (1-(point[1]-bottom)/height)*428)


def transform(cells, point):
    def number(key, default=0):
        value = cells.get(key)
        return float(value) if value is not None else default
    x = (point[0]-number('LocPinX', number('Width')/2)) * (-1 if cells.get('FlipX') == '1' else 1)
    y = (point[1]-number('LocPinY', number('Height')/2)) * (-1 if cells.get('FlipY') == '1' else 1)
    angle = number('Angle')
    return (number('PinX') + x*math.cos(angle) - y*math.sin(angle),
            number('PinY') + x*math.sin(angle) + y*math.cos(angle))


def reference_labels(reference):
    with zipfile.ZipFile(reference) as archive:
        root = ET.fromstring(archive.read('visio/pages/page1.xml'))
    labels = {}
    def visit(element, parents):
        if element.tag.rsplit('}', 1)[-1] == 'Shape':
            cells = {c.get('N'): c.get('V') for c in element.findall('v:Cell', NS)}
            text = element.find('v:Text', NS)
            label = ''.join(text.itertext()).strip() if text is not None else ''
            if re.fullmatch(r'S[1-5]-M(?:[1-9]|1[0-2])', label):
                if label in labels:
                    raise ValueError('Duplicate reference label: ' + label)
                point = (float(cells.get('PinX', 0)), float(cells.get('PinY', 0)))
                for parent in reversed(parents):
                    point = transform(parent, point)
                labels[label] = page_to_pixel(point)
            parents = parents + [cells]
        for child in element:
            visit(child, parents)
    visit(root, [])
    expected = {'S%d-M%d' % (string, module) for string in range(1,6) for module in range(1,13)}
    if set(labels) != expected:
        raise ValueError('Reference labels do not match the expected five 12-module sample strings')
    return labels


def audit(reference, port_data, inventory, tolerance=5):
    labels = reference_labels(reference)
    modules = port_data['modules']
    if len(modules) != 60:
        raise ValueError('Expected exactly 60 candidate modules')
    assignments, distances, used = {}, [], set()
    for label, point in labels.items():
        distance, index = min((math.dist(point, (module['face_x']+44, module['face_y']+12.5)), i)
                              for i, module in enumerate(modules))
        if distance > 15 or index in used:
            raise ValueError('Ambiguous label-to-module match: ' + label)
        used.add(index); distances.append(distance)
        ports = {port['name']: port['point'] for port in modules[index]['ports']}
        if set(ports) != {'S','N','negative','positive'} or any(p is None for p in ports.values()):
            raise ValueError('Incomplete module ports: ' + label)
        assignments[label] = {name:(point['x'],point['y']) for name, point in ports.items()}
    references = {'red': [], 'green': []}
    for shape in inventory['reference']['1']['candidates']:
        if shape['color'] in references:
            references[shape['color']].append((shape['shape_id'], page_to_pixel(shape['begin']), page_to_pixel(shape['end'])))
    def nearest(a, b, color):
        if not references[color]:
            raise ValueError('No reference candidates for ' + color)
        options=[]
        for shape_id, start, end in references[color]:
            direct=max(math.dist(a,start),math.dist(b,end))
            reverse=max(math.dist(a,end),math.dist(b,start))
            options.append((min(direct,reverse),shape_id))
        return min(options)
    output = {}
    for name, color, first, second in (('R02_neg_to_next_pos','red','negative','positive'),
                                        ('reverse_pos_to_next_neg','red','positive','negative'),
                                        ('R03_S_to_next_N','green','S','N'),
                                        ('reverse_N_to_next_S','green','N','S')):
        errors=[]; example=None
        for string in range(1,6):
            for module in range(1,12):
                first_id='S%d-M%d' % (string,module); second_id='S%d-M%d' % (string,module+1)
                error,shape=nearest(assignments[first_id][first],assignments[second_id][second],color)
                errors.append(error)
                if string==5 and module==11:
                    example={'from':first_id+':'+first, 'to':second_id+':'+second,
                             'nearest_shape':shape, 'error_px':round(error,2)}
        output[name]={'pairs':len(errors),'within_tolerance':sum(e <= tolerance for e in errors),
                      'median_error_px':round(statistics.median(errors),2),'example':example}
    return {'status':'fixture-specific visual proximity; not electrical approval',
            'label_matches':len(assignments),'unique_module_candidates':len(used),
            'max_label_distance_px':round(max(distances),2),'tolerance_px':tolerance,
            'reference_shapes_may_be_reused':True,'comparisons':output}

if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    reference, ports, inventory = map(Path, sys.argv[1:])
    try:
        print(json.dumps(audit(reference, json.loads(ports.read_text(encoding='utf-8')),
                               json.loads(inventory.read_text(encoding='utf-8'))), indent=2))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        sys.exit('Reference audit failed: ' + str(error))
