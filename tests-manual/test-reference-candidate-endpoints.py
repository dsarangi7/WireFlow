"""Verify the fixture's confirmed SSC endpoints in an actual generated SVG."""
import json
import os
import pathlib
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
INPUT = pathlib.Path('G:/WiringTool')


class ReferenceCandidateEndpoints(unittest.TestCase):
    def test_generated_svg_has_confirmed_endpoints(self):
        inputs = [pathlib.Path(os.environ.get('WIREFLOW_CANDIDATE_SVG', INPUT / 'candidate-confirmed-power.svg')), INPUT / 'rack-module-port-candidates.json', INPUT / 'rack-device-port-candidates.json']
        if not all(p.is_file() for p in inputs):
            self.skipTest('Fixture candidate files are not available')
        modules = json.loads(inputs[1].read_text(encoding='utf-8'))['modules']
        devices = sorted(json.loads(inputs[2].read_text(encoding='utf-8'))['ssc'], key=lambda item: item['x'])
        xmin, xmax = min(m['face_x'] for m in modules), max(m['face_x'] for m in modules)
        ymin, ymax = min(m['face_y'] for m in modules), max(m['face_y'] for m in modules)
        slots = {(round((m['face_x'] - xmin) / ((xmax - xmin) / 9)), round((m['face_y'] - ymin) / ((ymax - ymin) / 7))): m for m in modules}
        def port(entity, name):
            return next(p['point'] for p in entity['ports'] if p['name'] == name)
        wires = [e for e in ET.parse(inputs[0]).iter() if e.tag.endswith('polyline') and e.get('stroke') == '#e02020']
        paths = [[tuple(map(float, point.split(','))) for point in w.get('points').split()] for w in wires]
        def near(point, expected):
            return abs(point[0] - expected['x']) < .1 and abs(point[1] - expected['y']) < .1
        for index, device in enumerate(devices):
            pairs = [(port(device, 'string+'), port(slots[(2 * index, 0)], 'positive')),
                     (port(device, 'string-'), port(slots[(2 * index + 1, 4)], 'negative'))]
            for start, end in pairs:
                self.assertEqual(sum(near(p[0], start) and near(p[-1], end) for p in paths), 1)
            order = [(2 * index + 1, r + 4) for r in range(4)] + [(2 * index, 7 - r) for r in range(8)]
            for previous, following in zip(order, order[1:]):
                start, end = port(slots[previous], 'positive'), port(slots[following], 'negative')
                self.assertEqual(sum(near(p[0], start) and near(p[-1], end) for p in paths), 1)


if __name__ == '__main__':
    unittest.main()
