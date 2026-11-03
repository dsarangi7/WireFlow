"""Audit fixture SSC-to-module endpoint candidates against reference geometry.

Usage: python tests-manual/audit-reference-ssc-links.py REFERENCE.vsdx MODULES.json DEVICES.json COMPONENTS.json
Reference labels, image-port candidates and proximity do not establish approved
electrical connectivity. This assumes the sample's left-to-right SSC5..SSC1 order.
"""
import importlib.util
import json
import math
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('reference_module_audit', HERE/'audit-reference-module-links.py')
module_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module_audit)


def audit(reference, modules_data, device_data, component_data, tolerance=5):
    labels = module_audit.reference_labels(reference)
    modules = modules_data['modules']
    sscs = sorted(device_data['ssc'], key=lambda item: item['x'])
    if len(modules) != 60 or len(sscs) != 5:
        raise ValueError('Expected 60 module candidates and five SSC candidates')
    matched, used = {}, set()
    for label, point in labels.items():
        distance, index = min((math.dist(point, (m['face_x']+44, m['face_y']+12.5)), i)
                              for i, m in enumerate(modules))
        if distance > 15 or index in used:
            raise ValueError('Ambiguous module match: ' + label)
        used.add(index)
        matched[label] = {p['name']: p['point'] for p in modules[index]['ports']}
    def xy(point):
        if point is None or not all(math.isfinite(point[k]) for k in ('x', 'y')):
            raise ValueError('Missing or invalid endpoint')
        return (point['x'], point['y'])
    by_color = {'red': [], 'green': []}
    for component in component_data['components']:
        color = component['color']
        if color not in by_color or component['branch_nodes'] != 0:
            continue
        points = [point for edge in component['edges'] for point in (edge['begin'],edge['end'])]
        ends = [point for point in points if sum(math.dist(point, other) <= .01 for other in points) == 1]
        if len(ends) == 2:
            by_color[color].append((component['shape_ids'], *map(module_audit.page_to_pixel, ends)))
    def nearest(p, q, color):
        if not by_color[color]:
            raise ValueError('No unbranched reference geometry for ' + color)
        return min((min(max(math.dist(p,a), math.dist(q,b)), max(math.dist(p,b), math.dist(q,a))), ids)
                   for ids, a, b in by_color[color])
    comparisons = {}
    scenarios = [
        ('R04_SSC_plus_to_M1_plus','red','string+','M1','positive'),
        ('R05_SSC_minus_to_M12_minus','red','string-','M12','negative'),
        ('reference_SSC_plus_to_M12_plus','red','string+','M12','positive'),
        ('reference_SSC_minus_to_M1_minus','red','string-','M1','negative'),
        ('R06_SSC_S_to_M1_N','green','S','M1','N'),
        ('R06_SSC_N_to_M12_S','green','N','M12','S'),
    ]
    for name,color,ssc_port,module_name,module_port in scenarios:
        errors=[]; example=None
        for i, ssc in enumerate(sscs):
            group=5-i
            ports={p['name']:p['point'] for p in ssc['ports']}
            module_id='S%d-%s' % (group,module_name)
            error,ids=nearest(xy(ports[ssc_port]),xy(matched[module_id][module_port]),color)
            errors.append(error)
            if group==5:
                example={'ssc_port':ssc_port,'module':module_id+':'+module_port,
                         'nearest_shapes':ids,'error_px':round(error,2)}
        comparisons[name]={'pairs':len(errors),'within_tolerance':sum(e<=tolerance for e in errors),
                           'median_error_px':round(statistics.median(errors),2),'example':example}
    return {'status':'fixture-specific unbranched geometric proximity; not electrical approval',
            'tolerance_px':tolerance,'reference_components_may_be_reused':True,'comparisons':comparisons}

if __name__ == '__main__':
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    reference, modules, devices, components = map(Path,sys.argv[1:])
    try:
        load=lambda p:json.loads(p.read_text(encoding='utf-8'))
        print(json.dumps(audit(reference,load(modules),load(devices),load(components)),indent=2))
    except (OSError, ValueError, KeyError) as error:
        sys.exit('SSC audit failed: '+str(error))
