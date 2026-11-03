import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('run-reference-candidate.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class PowerCrossingGate(unittest.TestCase):
    def test_rejects_power_crossing(self):
        root = ET.fromstring('<svg><polyline stroke="#e02020" points="0,0 2,2"/><polyline stroke="#e02020" points="0,2 2,0"/></svg>')
        with self.assertRaisesRegex(ValueError, 'Power cable crossings'):
            runner.require_no_power_crossings(root)

    def test_allows_reference_style_power_communication_overlap(self):
        root = ET.fromstring('<svg><polyline stroke="#e02020" points="0,0 2,2"/><polyline stroke="#00a651" points="0,2 2,0"/></svg>')
        runner.require_no_power_crossings(root)

    def test_rejects_power_touch_and_collinear_overlap(self):
        for points in ('2,2 3,1', '1,1 3,3'):
            root = ET.fromstring('<svg><polyline stroke="#e02020" points="0,0 2,2"/><polyline stroke="#e02020" points="' + points + '"/></svg>')
            with self.assertRaises(ValueError):
                runner.require_no_power_crossings(root)


if __name__ == '__main__':
    unittest.main()
