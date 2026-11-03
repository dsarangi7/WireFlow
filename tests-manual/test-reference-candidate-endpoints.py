"""Verify the fixture's confirmed SSC endpoints in an actual generated SVG."""
import json
import math
import os
import pathlib
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
INPUT = pathlib.Path('G:/WiringTool')


class ReferenceCandidateEndpoints(unittest.TestCase):
    def test_generated_svg_has_confirmed_endpoints(self):
        inputs = [pathlib.Path(os.environ.get('WIREFLOW_CANDIDATE_SVG', INPUT / 'sample-colored-labels/EXPERIMENTAL-rack-DO-NOT-BUILD.svg')),
                  pathlib.Path(os.environ.get('WIREFLOW_CANDIDATE_MODULES', INPUT / 'rack-module-port-candidates.json')),
                  pathlib.Path(os.environ.get('WIREFLOW_CANDIDATE_DEVICES', INPUT / 'rack-device-port-candidates.json'))]
        if not all(p.is_file() for p in inputs):
            self.skipTest('Fixture candidate files are not available')
        modules = json.loads(inputs[1].read_text(encoding='utf-8'))['modules']
        device_data = json.loads(inputs[2].read_text(encoding='utf-8'))
        devices = sorted(device_data['ssc'], key=lambda item: item['x'])
        junctions = sorted(device_data['junction_boxes'], key=lambda item: item['x'])
        self.assertEqual(len(devices), 5)
        self.assertEqual(len(junctions), 5)
        xmin, xmax = min(m['face_x'] for m in modules), max(m['face_x'] for m in modules)
        ymin, ymax = min(m['face_y'] for m in modules), max(m['face_y'] for m in modules)
        slots = {(round((m['face_x'] - xmin) / ((xmax - xmin) / 9)), round((m['face_y'] - ymin) / ((ymax - ymin) / 7))): m for m in modules}
        def port(entity, name):
            return next(p['point'] for p in entity['ports'] if p['name'] == name)
        svg = ET.parse(inputs[0])
        text_elements = [e for e in svg.iter() if e.tag.endswith('text')]
        texts = [''.join(e.itertext()).strip() for e in text_elements]
        labels = ['SSC' + str(number) for number in range(1, 6)] + ['MSM', 'ACDP1', 'ACDP2']
        for label in labels:
            self.assertEqual(texts.count(label), 1)
        reference_colors = {1:'#4bacc6', 2:'#7e649e', 3:'#fee599', 4:'#7f7f7f', 5:'#f9c499'}
        for string, color in reference_colors.items():
            for module in range(1, 13):
                label = f'S{string}-M{module}'
                self.assertEqual(texts.count(label), 1)
                self.assertEqual(text_elements[texts.index(label)].get('fill'), color)
        # Reference-derived coordinates belong to this fixture only.
        reference_positions = {'SSC1': (1050.7, 148.2), 'SSC2': (835.2, 137.8),
                               'SSC3': (622.9, 137.0), 'SSC4': (413.1, 137.8),
                               'SSC5': (197.6, 137.8), 'MSM': (1054.0, 57.0),
                               'ACDP1': (1054.4, 111.0), 'ACDP2': (411.6, 98.9)}
        for label, expected in reference_positions.items():
            element = text_elements[texts.index(label)]
            actual = (float(element.get('x')), float(element.get('y')))
            self.assertLess(math.dist(actual, expected), 4, label)
        sheet_path = os.environ.get('WIREFLOW_CANDIDATE_SHEET')
        if sheet_path:
            sheet = ET.parse(sheet_path)
            sheet_texts = [''.join(e.itertext()).strip() for e in sheet.iter() if e.tag.endswith('text')]
            self.assertIn('Power cable', sheet_texts)
            self.assertIn('Communication cable', sheet_texts)
            for zone in ('8', '1', 'F', 'A'):
                self.assertEqual(sheet_texts.count(zone), 2)
            for label in labels:
                self.assertEqual(sheet_texts.count(label), 1)
                rack_element = text_elements[texts.index(label)]
                sheet_element = [e for e in sheet.iter() if e.tag.endswith('text')][sheet_texts.index(label)]
                scale = min(1510 / 1155, 740 / 428)
                expected = (85 + (1510 - 1155 * scale) / 2 + float(rack_element.get('x')) * scale,
                            145 + (740 - 428 * scale) / 2 + float(rack_element.get('y')) * scale)
                actual = (float(sheet_element.get('x')), float(sheet_element.get('y')))
                self.assertLess(math.dist(actual, expected), 1, label)
            for string, color in reference_colors.items():
                for module in range(1, 13):
                    label = f'S{string}-M{module}'
                    self.assertEqual(sheet_texts.count(label), 1)
                    self.assertEqual([e for e in sheet.iter() if e.tag.endswith('text')][sheet_texts.index(label)].get('fill'), color)
        wires = [e for e in svg.iter() if e.tag.endswith('polyline') and e.get('stroke') == '#e02020']
        paths = [[tuple(map(float, point.split(','))) for point in w.get('points').split()] for w in wires]
        green_wires = [e for e in svg.iter() if e.tag.endswith('polyline') and e.get('stroke') == '#00a651']
        green_paths = [[tuple(map(float, point.split(','))) for point in w.get('points').split()] for w in green_wires]
        self.assertEqual((len(paths), len(green_paths)), (75, 65))
        if sheet_path:
            # Compare each exported segment, rather than only the number of
            # wires. Rack coordinates are rounded to tenths, sheet to hundredths.
            scale = min(1510 / 1155, 740 / 428)
            ox = 85 + (1510 - 1155 * scale) / 2
            oy = 145 + (740 - 428 * scale) / 2
            for rack_paths, color in ((paths, '#dc2626'), (green_paths, '#16a34a')):
                lines = [e for e in sheet.iter() if e.tag.endswith('line') and e.get('stroke') == color]
                remaining = [((float(e.get('x1')), float(e.get('y1'))),
                              (float(e.get('x2')), float(e.get('y2')))) for e in lines]
                for path in rack_paths:
                    for a, b in zip(path, path[1:]):
                        target = ((ox + a[0] * scale, oy + a[1] * scale),
                                  (ox + b[0] * scale, oy + b[1] * scale))
                        matches = [(max(math.dist(target[0], candidate[0]), math.dist(target[1], candidate[1])), i)
                                   for i, candidate in enumerate(remaining)]
                        self.assertTrue(matches, 'Missing A3 wire segment')
                        error, index = min(matches)
                        self.assertLess(error, .15, 'A3 wire segment moved or changed color')
                        remaining.pop(index)
                self.assertFalse(remaining, 'Unexpected extra A3 wire segments')
        def near(point, expected):
            return abs(point[0] - expected['x']) < .1 and abs(point[1] - expected['y']) < .1
        for index, device in enumerate(devices):
            pairs = [(port(device, 'string+'), port(slots[(2 * index, 0)], 'positive')),
                     (port(device, 'string-'), port(slots[(2 * index + 1, 4)], 'negative')),
                     (port(device, 'bus+'), port(junctions[index], 'positive')),
                     (port(device, 'bus-'), port(junctions[index], 'negative'))]
            for start, end in pairs:
                self.assertEqual(sum(near(p[0], start) and near(p[-1], end) for p in paths), 1)
            order = [(2 * index + 1, r + 4) for r in range(4)] + [(2 * index, 7 - r) for r in range(8)]
            for previous, following in zip(order, order[1:]):
                start, end = port(slots[previous], 'positive'), port(slots[following], 'negative')
                self.assertEqual(sum(near(p[0], start) and near(p[-1], end) for p in paths), 1)
                start, end = port(slots[previous], 'S'), port(slots[following], 'N')
                self.assertEqual(sum(near(p[0], start) and near(p[-1], end) for p in green_paths), 1)
            for start, end in ((port(device, 'S'), port(slots[order[0]], 'N')),
                               (port(device, 'N'), port(slots[order[-1]], 'S'))):
                self.assertEqual(sum(near(p[0], start) and near(p[-1], end) for p in green_paths), 1)
            for candidates, first, second in ((paths, 'positive', 'negative'), (green_paths, 'S', 'N')):
                start, end = port(slots[order[3]], first), port(slots[order[4]], second)
                matches = [p for p in candidates if near(p[0], start) and near(p[-1], end)]
                self.assertEqual(len(matches), 1)
                self.assertGreater(len(matches[0]), 2)
                self.assertGreater(max(point[1] for point in matches[0]), max(start['y'], end['y']) + 5)


if __name__ == '__main__':
    unittest.main()
