"""Experimental module-port candidates for the supplied rack image ONLY.

Usage: python tests-manual/reference-port-candidates.py RACK_3X.png MODULE_FACES.json OUTPUT.json
The first-module template and four search windows are fixture-specific, and the
input module-face candidates are themselves produced by sample-specific templates.
Detected circles are candidates, not validated terminal identities or wiring.
"""
import json
import math
import sys
from pathlib import Path
import cv2

# Estimated from the first module on the input image; the confirmed left-to-right
# order supplies the names. Offsets are NOT a general device-port definition.
PORTS = (('S', 10.8), ('N', 23.2), ('negative', 69.2), ('positive', 79.8))


def detect(image, modules):
    if image is None or image.shape != (1283, 3465):
        raise ValueError('Expected the fixture-specific 3465 x 1283 rack image')
    result = []
    for module in modules:
        x, y = module['x'], module['y']
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y)):
            raise ValueError('Invalid module-face position')
        ports = []
        for name, offset in PORTS:
            center_x, center_y = (x + offset) * 3, (y + 29) * 3
            x0, y0 = int(center_x - 16), int(center_y - 16)
            crop = image[y0:y0 + 32, x0:x0 + 32] if x0 >= 0 and y0 >= 0 else None
            if crop is None or crop.shape != (32, 32):
                ports.append({'name': name, 'point': None}); continue
            circles = cv2.HoughCircles(cv2.GaussianBlur(crop, (3, 3), 0),
                cv2.HOUGH_GRADIENT, dp=1, minDist=9, param1=100, param2=10,
                minRadius=3, maxRadius=10)
            if circles is None:
                ports.append({'name': name, 'point': None}); continue
            circle = min(circles[0], key=lambda p: (p[0]+x0-center_x)**2 + (p[1]+y0-center_y)**2)
            ports.append({'name': name, 'point': {'x': round((float(circle[0])+x0)/3, 2),
                                                   'y': round((float(circle[1])+y0)/3, 2)}})
        result.append({'face_x': x, 'face_y': y, 'ports': ports})
    return result


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    image_path, modules_path, output_path = map(Path, sys.argv[1:])
    if output_path.resolve() in (image_path.resolve(), modules_path.resolve()):
        sys.exit('Output cannot overwrite an input')
    modules = json.loads(modules_path.read_text(encoding='utf-8'))['candidates']
    result = detect(cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE), modules)
    output_path.write_text(json.dumps({'status': 'experimental candidates; do not wire without review',
        'coordinate_space': '1155 x 428 reference rack image, y down', 'modules': result}, indent=2), encoding='utf-8')
    print('Modules:', len(result), 'with four circle candidates:',
          sum(all(port['point'] is not None for port in module['ports']) for module in result))

if __name__ == '__main__':
    main()
