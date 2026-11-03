"""Fixture-specific SSC and junction-box port candidates for the supplied rack.

Usage: python tests-manual/reference-device-candidates.py RACK.png RACK_3X.png OUTPUT.json
All templates and search windows are specific to this one rack image. Results
are unapproved visual candidates: no SSC/JB association or wiring is inferred.
"""
import json
import sys
from pathlib import Path
import cv2
import numpy as np

SSC = (('S', 11), ('N', 21), ('string+', 28), ('bus+', 39), ('bus-', 49), ('string-', 58))
JB = (('positive', 46), ('negative', 60))


def boxes(image, region, threshold):
    x, y, width, height = region
    template = image[y:y+height, x:x+width]
    if template.shape != (height, width) or float(template.std()) < 10:
        raise ValueError('Fixture template is missing or lacks visual detail')
    scoremap = cv2.matchTemplate(image, template, cv2.TM_CCOEFF_NORMED)
    found = []
    while True:
        _, score, _, (left, top) = cv2.minMaxLoc(scoremap)
        if score < threshold:
            break
        found.append({'x': left, 'y': top, 'score': round(float(score), 4)})
        scoremap[max(0, top-25):top+26, max(0, left-35):left+36] = -1
    return sorted(found, key=lambda b: (b['x'], b['y']))


def port_candidates(hi, candidates, first, port_defs, y_offset, threshold=.70):
    reference_x, reference_y = first
    for box in candidates:
        ports = []
        for name, offset in port_defs:
            sx, sy = 3*(reference_x+offset), 3*(reference_y+y_offset)
            half, radius = 10, 10
            template = hi[sy-half:sy+half+1, sx-half:sx+half+1]
            cx, cy = 3*(box['x']+offset), 3*(box['y']+y_offset)
            left, top = cx-half-radius, cy-half-radius
            region = hi[top:cy+half+radius+1, left:cx+half+radius+1] if left >= 0 and top >= 0 else None
            if template.shape != (21,21) or float(template.std()) < 10 or region is None or region.shape != (41,41):
                ports.append({'name': name, 'point': None}); continue
            result = cv2.matchTemplate(region, template, cv2.TM_CCOEFF_NORMED)
            _, score, _, (px, py) = cv2.minMaxLoc(result)
            if score < threshold:
                ports.append({'name': name, 'point': None, 'score': round(float(score), 4)}); continue
            ports.append({'name': name, 'point': {'x': round((left+px+half)/3, 2),
                                                   'y': round((top+py+half)/3, 2)},
                          'score': round(float(score), 4)})
        box['ports'] = ports
    return candidates


def detect(image, hi):
    if image is None or image.shape != (428, 1155) or hi is None or hi.shape != (1283, 3465):
        raise ValueError('Expected the two fixture-specific 1155x428 and 3465x1283 rack images')
    ssc = boxes(image, (163, 127, 74, 59), .74)
    jb = boxes(image, (160, 13, 78, 20), .85)
    return {'status': 'experimental visual candidates; do not wire without engineering review',
            'coordinate_space': '1155 x 428 rack image, y down',
            'ssc': port_candidates(hi, ssc, (163, 127), SSC, 66),
            'junction_boxes': port_candidates(hi, jb, (160, 13), JB, 12)}


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    low, high, output = map(Path, sys.argv[1:])
    if output.resolve() in (low.resolve(), high.resolve()):
        sys.exit('Output cannot overwrite an input')
    data = detect(cv2.imread(str(low), 0), cv2.imread(str(high), 0))
    output.write_text(json.dumps(data, indent=2), encoding='utf-8')
    for kind in ('ssc', 'junction_boxes'):
        print(kind, 'candidates:', len(data[kind]), 'with all ports:',
              sum(all(p['point'] is not None for p in item['ports']) for item in data[kind]))
