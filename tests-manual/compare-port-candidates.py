"""Check fixture module-port candidates against nearest colored reference endpoints.

Usage: python tests-manual/compare-port-candidates.py PORTS.json INVENTORY.json
Reference endpoints may be reused. Proximity does not prove terminal identity,
correct wiring, or that the reference endpoint is electrically connected.
"""
import json
import math
import statistics
import sys
from pathlib import Path


def compare(ports, inventory):
    # Fixture-specific location of the rack picture on the reference page.
    left, bottom, width, height = 1.617195811466863, 5.361483135485282, 13.92472787730751, 5.1592174425
    references = {'red': [], 'green': []}
    for edge in inventory['reference']['1']['candidates']:
        if edge['color'] not in references:
            continue
        for x, y in (edge['begin'], edge['end']):
            references[edge['color']].append(((x-left)/width*1155, (1-(y-bottom)/height)*428))
    errors = {'red': [], 'green': []}
    missing = 0
    for module in ports['modules']:
        for port in module['ports']:
            point = port['point']
            if point is None:
                missing += 1; continue
            if port['name'] not in ('S', 'N', 'negative', 'positive'):
                raise ValueError('Unknown module port label')
            color = 'green' if port['name'] in ('S', 'N') else 'red'
            if not references[color]:
                raise ValueError('No reference endpoint candidates for ' + color)
            errors[color].append(min(math.dist((point['x'], point['y']), ref) for ref in references[color]))
    return {'status': 'nearest visual candidates only; no electrical validation', 'missing': missing,
        'colors': {color: {'count': len(values), 'within_3px': sum(v <= 3 for v in values),
                           'within_5px': sum(v <= 5 for v in values),
                           'median_px': round(statistics.median(values), 2) if values else None,
                           'max_px': round(max(values), 2) if values else None}
                   for color, values in errors.items()}}

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    ports, inventory = (json.loads(Path(p).read_text(encoding='utf-8')) for p in sys.argv[1:])
    print(json.dumps(compare(ports, inventory), indent=2))
