"""Experimental module candidates for the supplied 111.vsdx rack image only.

Usage: python tests-manual/reference-module-candidates.py RACK.png CANDIDATES.json
The input must be the 1155x428 extracted display image of the supplied rack.
Templates are sampled from that image, so this is a fixture-specific experiment,
not a general detector, terminal locator, or approved electrical layout.
"""
import json
import sys
from pathlib import Path
import cv2


def find(image):
    if image is None or image.shape != (428, 1155):
        raise ValueError('Expected the 1155 x 428 grayscale reference rack image')
    found = []
    for template_y in (38, 83, 218, 352):
        template = image[template_y:template_y + 25, 48:136]
        scores = cv2.matchTemplate(image, template, cv2.TM_CCOEFF_NORMED)
        while True:
            _, score, _, (x, y) = cv2.minMaxLoc(scores)
            if score < 0.8:
                break
            if not any(abs(x - old['x']) < 8 and abs(y - old['y']) < 8 for old in found):
                found.append({'x': x, 'y': y, 'width': 88, 'height': 25,
                              'score': round(float(score), 5), 'template_y': template_y})
            scores[max(0, y - 12):y + 13, max(0, x - 40):x + 41] = -1
    return sorted(found, key=lambda item: (item['x'], item['y']))


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    source, output = map(Path, sys.argv[1:])
    if source.resolve() == output.resolve():
        sys.exit('Output must not overwrite the source image')
    candidates = find(cv2.imread(str(source), cv2.IMREAD_GRAYSCALE))
    result = {'status': 'experimental candidates; verify before use',
              'image_width': 1155, 'image_height': 428, 'candidates': candidates}
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print('Candidate module faces:', len(candidates))

if __name__ == '__main__':
    main()
