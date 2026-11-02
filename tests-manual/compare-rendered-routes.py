"""Compare colored pixels in fixture-aligned SVG diagnostics.

Usage: python tests-manual/compare-rendered-routes.py DRAFT.svg REFERENCE_OVERLAY.svg
Requires PyMuPDF, numpy, and OpenCV. Both inputs must use the same rack picture,
size and crop. This compares drawing pixels, not components, continuity, cable
separation, physical routes or electrical correctness. The fixture's first 26
rows are excluded because each diagnostic has a red warning banner there.
"""
import json
import sys
from pathlib import Path
import cv2
import fitz
import numpy as np


def read_svg(path):
    with fitz.open(path) as doc:
        if len(doc) != 1:
            raise ValueError('Expected one SVG page')
        pix = doc[0].get_pixmap(alpha=False)
        if pix.n != 3:
            raise ValueError('Expected an RGB render')
        return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3).copy()


def mask(image, color):
    red, green, blue = [image[:, :, k].astype(np.int16) for k in range(3)]
    if color == 'red':
        selected = (red > 100) & (red > green * 1.4) & (red > blue * 1.4)
    elif color == 'green':
        selected = (green > 75) & (green > red * 1.35) & (green > blue * 1.25)
    else:
        raise ValueError('Unknown color')
    selected[:26, :] = False
    return selected


def metrics(generated, reference, tolerance):
    if generated.shape != reference.shape or generated.ndim != 2:
        raise ValueError('Masks must have matching dimensions')
    if tolerance < 0:
        raise ValueError('Tolerance cannot be negative')
    def fraction(source, target):
        count = int(source.sum())
        if count == 0 or not target.any():
            return None
        distance = cv2.distanceTransform((~target).astype(np.uint8), cv2.DIST_L2, 5)
        return float((source & (distance <= tolerance)).sum() / count)
    return {'draft_color_pixels': int(generated.sum()), 'reference_color_pixels': int(reference.sum()),
            'draft_near_reference_fraction': fraction(generated, reference),
            'reference_near_draft_fraction': fraction(reference, generated)}


def compare(draft, reference):
    if draft.shape != reference.shape or draft.shape[:2] != (428, 1155):
        raise ValueError('Expected two aligned 1155 x 428 rack renders')
    return {color: {str(t): metrics(mask(draft, color), mask(reference, color), t)
                    for t in (2, 4)} for color in ('red', 'green')}


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    result = compare(read_svg(Path(sys.argv[1])), read_svg(Path(sys.argv[2])))
    print(json.dumps(result, indent=2))
