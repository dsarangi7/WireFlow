"""Group same-color reference shape endpoints into geometric components.

Usage: python tests-manual/reference-route-components.py inventory.json output.json tolerance_inches
The grouping is a proximity heuristic, not a netlist or evidence of a cable.
"""
import collections
import json
import math
import sys
from pathlib import Path


def components(candidates, tolerance):
    if not math.isfinite(tolerance) or tolerance <= 0:
        raise ValueError('tolerance must be finite and positive')
    answer = []
    for color in ('red', 'green'):
        edges = [row for row in candidates if row['color'] == color]
        points = [point for edge in edges for point in (edge['begin'], edge['end'])]
        parents = list(range(len(points)))
        def find(index):
            while parents[index] != index:
                parents[index] = parents[parents[index]]
                index = parents[index]
            return index
        def join(a, b):
            a, b = find(a), find(b)
            if a != b:
                parents[b] = a
        for i, point in enumerate(points):
            for j in range(i):
                if math.dist(point, points[j]) <= tolerance:
                    join(i, j)
        clusters = [find(i) for i in range(len(points))]
        degrees = collections.Counter(clusters)
        for i in range(len(edges)):
            join(2*i, 2*i + 1)
        groups = collections.defaultdict(list)
        for i in range(len(edges)):
            groups[find(2*i)].append(i)
        for indices in groups.values():
            nodes = set(clusters[2*i+k] for i in indices for k in (0, 1))
            answer.append({'color': color, 'shape_ids': [edges[i]['shape_id'] for i in indices],
                'segments': len(indices), 'endpoint_nodes': len(nodes),
                'terminal_nodes': sum(degrees[n] == 1 for n in nodes),
                'branch_nodes': sum(degrees[n] > 2 for n in nodes),
                'edges': [{'shape_id': edges[i]['shape_id'], 'begin': edges[i]['begin'],
                           'end': edges[i]['end'], 'geometry_rows': edges[i]['geometry_rows']} for i in indices]})
    return answer


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    source, output = map(Path, sys.argv[1:3])
    if source.resolve() == output.resolve():
        sys.exit('Output must not overwrite the inventory')
    tolerance = float(sys.argv[3])
    inventory = json.loads(source.read_text(encoding='utf-8'))
    groups = components(inventory['reference']['1']['candidates'], tolerance)
    result = {'status': 'geometric proximity candidates only; not approved cables or connectivity',
              'tolerance_inches': tolerance, 'components': groups}
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    for color in ('red', 'green'):
        counts = collections.Counter(g['segments'] for g in groups if g['color'] == color)
        print(color, 'components by segment count:', dict(sorted(counts.items())))

if __name__ == '__main__':
    main()
