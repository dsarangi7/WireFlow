"""Create a review image of the first two crossing types and the reference.

Usage: python tests-manual/crossing-review.py DRAFT.svg REFERENCE.svg OUTPUT.png
This is an image-space diagnostic, not a physical cable-clearance check.
"""
import importlib.util
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('crossings', HERE/'audit-svg-crossings.py')
crossings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crossings)


def render(path):
    with fitz.open(path) as document:
        if len(document) != 1:
            raise ValueError('Expected a single SVG page')
        pix = document[0].get_pixmap(alpha=False)
        if (pix.width, pix.height, pix.n) != (1155, 428, 3):
            raise ValueError('Expected aligned 1155 by 428 rack SVGs')
        return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)


def create(draft_path, reference_path, output):
    import xml.etree.ElementTree as ET
    if output.exists():
        raise FileExistsError('Choose a new output path')
    report = crossings.audit(ET.parse(draft_path).getroot())
    points = [entry['points'][0] for entry in report['crossings'] if entry['types'].count('power') == 1]
    if len(points) < 2:
        raise ValueError('Expected upper and lower power/communication crossings')
    lower = max(points, key=lambda point: point[1])
    upper = min(points, key=lambda point: point[1])
    draft, reference = render(draft_path), render(reference_path)
    out = Image.new('RGB', (720, 530), 'white')
    draw = ImageDraw.Draw(out)
    draw.text((15, 8), 'CROSSING REVIEW - image overlap only; engineering review required', fill='black')
    for row, (label, point) in enumerate((('Upper SSC rail', upper), ('Lower module cable', lower))):
        y = 45 + row * 235
        draw.text((15, y), label + ' | draft', fill='black')
        draw.text((375, y), label + ' | reference', fill='black')
        x0, y0 = round(point[0]-45), round(point[1]-25)
        box = (x0, y0, x0+90, y0+50)
        for col, image in enumerate((draft, reference)):
            crop = image.crop(box).resize((342, 190))
            x = 10 + col*360
            out.paste(crop, (x, y+20))
            cx = x + (point[0]-x0)*342/90
            cy = y+20 + (point[1]-y0)*190/50
            draw.ellipse((cx-11,cy-11,cx+11,cy+11), outline='#0066ff', width=3)
    with output.open('xb') as stream:
        out.save(stream, format='PNG')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    try:
        create(*map(Path, sys.argv[1:]))
    except (OSError, ValueError) as error:
        sys.exit('Cannot create review: ' + str(error))
