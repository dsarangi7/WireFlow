/* Rack "1111111111111111.dxf" (19 Nov 2026): 12 columns x 11 rows, drawn at about 1:44
 * (a module is 9 x 4.2 drawing units). Built from the DXF's terminal circles:
 * modules S,N,-,+ ; 9 SSCs with their connector strip at the bottom (S,N,S+,B+,B-,S-,
 * positions approximate); 5 junction boxes on top (P1+,P1-,P2+,P2-); the other
 * boxes in the module grid (MSM, ACDP...) as parts cables must not cross. */
'use strict';
const COLS = [80.34, 90.34, 100.34, 110.34, 120.34, 130.34, 140.34, 150.34, 160.34, 170.34, 180.34, 190.34];
const ROWS = [137.93, 133.73, 129.53, 125.33, 121.13, 116.93, 112.73, 108.53, 104.33, 100.13, 95.93];
const GRID = [
  '############',
  '############',
  '############',
  '##.###.#####',
  '##..##.#####',
  '##..##.#####',
  '.#.#.#.##..#',
  '.###.####..#',
  '#########..#',
  '#######.#..#',
  '.######.####'];
/* SSC: [column x, connector y] */
const SSCS = [[140.34, 120.74], [110.34, 116.54], [100.34, 112.34], [140.34, 112.34], [80.34, 108.14],
  [120.34, 108.14], [180.34, 108.14], [170.34, 99.74], [180.34, 99.74]];
const JBS = [90.34, 110.34, 140.34, 160.34, 180.34];
/* other parts in the grid: [column x, top row index, rows] */
const OTHER = [[100.34, 3, 2, 'msm'], [170.34, 6, 2, 'msm'], [150.34, 9, 2, 'msm'], [80.34, 10, 1, 'msm']];

function rack1111() {
  const comps = [];
  let n = 0;
  ROWS.forEach((ty, r) => COLS.forEach((sx, c) => {
    if (GRID[r][c] !== '#') return;
    const x0 = sx - 0.96, y0 = ty - 1.25;
    comps.push({ id: 'module-' + (++n), kind: 'module', x0: x0, y0: y0, x1: x0 + 9, y1: y0 + 4.2,
      terminals: [['comm-S', 0], ['comm-N', 0.8], ['power-', 5.84], ['power+', 6.84]].map(([role, dx]) => ({ role: role, x: sx + dx, y: ty })) });
  }));
  SSCS.forEach(([sx, cy], i) => {
    const x0 = sx - 0.96, y0 = cy - 0.86;
    comps.push({ id: 'ssc-' + (i + 1), kind: 'ssc', x0: x0, y0: y0, x1: x0 + 9, y1: y0 + 8.4,
      terminals: [['S', 2.04], ['N', 2.97], ['S+', 3.9], ['B+', 4.83], ['B-', 5.76], ['S-', 6.69]].map(([role, dx]) => ({ role: role, x: sx + dx, y: cy })) });
  });
  JBS.forEach((sx, i) => {
    comps.push({ id: 'jb-' + (i + 1), kind: 'jb', x0: sx - 0.47, y0: 141.1, x1: sx + 7.55, y1: 142.94,
      terminals: [['P1+', 1.44], ['P1-', 2.84], ['P2+', 4.24], ['P2-', 5.64]].map(([role, dx]) => ({ role: role, x: sx + dx, y: 141.82 })) });
  });
  OTHER.forEach(([sx, r, rows, kind], i) => {
    const x0 = sx - 0.96, y1 = ROWS[r] - 1.25 + 4.2;
    comps.push({ id: kind + '-' + (i + 1), kind: kind, x0: x0, y0: y1 - 4.2 * rows, x1: x0 + 9, y1: y1, terminals: [] });
  });
  return comps;
}
/* SSC1 is the rightmost, as the app names them; counts add up to the 107 modules */
function sscs1111(comps) {
  const s = comps.filter(c => c.kind === 'ssc').sort((a, b) => b.x0 - a.x0 || b.y0 - a.y0);
  /* junction box and pair per SSC, as an engineer would map them (5 boxes, 9 SSCs) */
  const jb = { 'ssc-7': ['jb-5', 'P1'], 'ssc-9': ['jb-5', 'P2'], 'ssc-8': ['jb-4', 'P1'], 'ssc-1': ['jb-3', 'P1'], 'ssc-4': ['jb-3', 'P2'],
    'ssc-6': ['jb-2', 'P2'], 'ssc-2': ['jb-2', 'P1'], 'ssc-3': ['jb-1', 'P2'], 'ssc-5': ['jb-1', 'P1'] };
  return s.map((c, i) => ({ comp: c, key: c.id, name: 'SSC' + (i + 1), count: i === s.length - 1 ? 11 : 12, jbId: jb[c.id][0], pair: jb[c.id][1] }));
}
module.exports = { rack1111, sscs1111 };
