import importlib.util
import pathlib
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('crossings', pathlib.Path(__file__).with_name('audit-svg-crossings.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CrossingAuditTests(unittest.TestCase):
    def test_interior_crossing_only(self):
        self.assertTrue(module.interior_cross((0, 0), (2, 2), (0, 2), (2, 0)))
        self.assertFalse(module.interior_cross((0, 0), (1, 1), (1, 1), (2, 0)))
        self.assertFalse(module.interior_cross((0, 0), (2, 0), (1, 0), (3, 0)))

    def test_count_wire_pairs_not_segments(self):
        root = ET.fromstring('<svg><polyline stroke="#e02020" points="0,0 2,2 4,0"/><polyline stroke="#00a651" points="0,1 4,1"/></svg>')
        report = module.audit(root)
        self.assertEqual(report['wire_polylines'], 2)
        self.assertEqual(report['crossing_wire_pairs']['power/communication'], 1)
        self.assertEqual(report['crossings'][0]['points'], [[1.0, 1.0], [3.0, 1.0]])


if __name__ == '__main__':
    unittest.main()
