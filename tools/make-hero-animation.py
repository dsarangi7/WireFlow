"""Build assets/rack-111-animated.svg for the product page hero.

Input: assets/rack-111-recognised.svg (the real rack 111 drawing with the
parts WireFlow recognised). Output: the same picture where the recognition is
replayed as a 12 s loop: a scan line sweeps the rack, modules light up column
by column, terminals appear, then junction boxes, SSCs (terminals coloured by
the AYK convention S, N, S+, B+, B-, S-), ACDPs, MSM and labels.

Everything stays visible without animation (prefers-reduced-motion).
Run from the repo root:  python tools/make-hero-animation.py
"""
import io
import re

SRC = 'assets/rack-111-recognised.svg'
OUT = 'assets/rack-111-animated.svg'
T = 12.0          # loop length, s
OUT_AT = 10.4     # everything fades out from here ...
GONE_AT = 11.2    # ... and is gone here

s = io.open(SRC, encoding='utf-8').read()
w, h = [int(v) for v in re.search(r'viewBox="0 0 (\d+) (\d+)"', s).groups()]
lines = re.search(r'<path [^>]*/>', s).group(0)
body = s[s.index('<g '):]
elems = re.findall(r'<(rect|circle|text)\b([^>]*?)(?:/>|>([^<]*)</text>)', body)

pct = lambda t: round(t / T * 100, 2)
keyframes = {}


def kf(name, at, dur=0.45):
    """Keyframes: hidden until `at`, shown after `at + dur`, out at OUT_AT."""
    if name not in keyframes:
        keyframes[name] = (
            f'@keyframes {name}{{0%,{pct(at)}%{{opacity:0;stroke-dashoffset:1;transform:scale(.7)}}'
            f'{pct(at + dur)}%,{pct(OUT_AT)}%{{opacity:1;stroke-dashoffset:0;transform:scale(1)}}'
            f'{pct(GONE_AT)}%,100%{{opacity:0;stroke-dashoffset:0;transform:scale(1)}}}}')
    return name


def attr(a, k):
    m = re.search(k + r'="([^"]*)"', a)
    return m.group(1) if m else None


COL = 500  # rack column pitch in the drawing (mm == svg units)
out = []
ssc_terms = []
for tag, a, text in elems:
    if tag == 'rect':
        stroke = attr(a, 'stroke')
        x = float(attr(a, 'x'))
        if stroke == '#38bdf8':                       # battery module
            col = int(x // COL)
            name = kf(f'm{col}', 0.9 + col * 0.28)
        else:
            name = kf({'#a78bfa': 'jb', '#f97316': 'ssc', '#facc15': 'acdp', '#f472b6': 'msm'}[stroke],
                      {'#a78bfa': 4.1, '#f97316': 4.7, '#facc15': 6.0, '#f472b6': 6.4}[stroke], 0.6)
        out.append(f'<rect{a} pathLength="1" class="d" style="animation-name:{name}"/>')
    elif tag == 'circle':
        fill = attr(a, 'fill')
        if fill == '#22d3ee':                          # SSC connector strip
            ssc_terms.append(a)
            continue
        col = int(float(attr(a, 'cx')) // COL)
        name = kf(f't{col}', 1.35 + col * 0.28, 0.3)
        out.append(f'<circle{a} class="p" style="animation-name:{name}"/>')
    else:
        name = kf('lbl', 6.8, 0.5)
        out.append(f'<text{a} class="p" style="animation-name:{name}">{text}</text>')

# SSC strips: six connectors each, left to right S, N (comm, green), S+, B+, B-, S- (power, red)
rows = {}
for a in ssc_terms:
    rows.setdefault(round(float(attr(a, 'cy'))), []).append(a)
roles = ['S', 'N', 'S+', 'B+', 'B-', 'S-']
for y, items in rows.items():
    items.sort(key=lambda a: float(attr(a, 'cx')))
    for i in range(0, len(items), 6):
        for j, a in enumerate(items[i:i + 6]):
            a2 = a.replace('fill="#22d3ee"', 'fill="%s"' % ('#22c55e' if j < 2 else '#ef4444'))
            out.append(f'<circle{a2} class="p" style="animation-name:{kf("st", 5.3, 0.35)}"><title>{roles[j]}</title></circle>')

scan = (f'<defs><linearGradient id="sg" x1="0" x2="1"><stop offset="0" stop-color="#00a8ff" stop-opacity="0"/>'
        f'<stop offset=".8" stop-color="#00a8ff" stop-opacity=".28"/><stop offset="1" stop-color="#7dd3fc" stop-opacity=".9"/></linearGradient></defs>'
        f'<rect class="scan" x="-420" y="0" width="420" height="{h}" fill="url(#sg)"/>')

css = ('<style>'
       '.d{stroke-dasharray:1;animation:12s linear infinite both}'
       '.p{transform-box:fill-box;transform-origin:center;animation:12s ease-out infinite both}'
       '.d{transform-box:fill-box;transform-origin:center}'
       f'.scan{{animation:scan {T}s linear infinite}}'
       f'@keyframes scan{{0%,{pct(0.7)}%{{transform:translateX(0);opacity:0}}{pct(0.9)}%{{opacity:1}}'
       f'{pct(3.9)}%{{opacity:1}}{pct(4.2)}%,100%{{transform:translateX({w + 420}px);opacity:0}}}}'
       + ''.join(keyframes.values()) +
       '@media (prefers-reduced-motion:reduce){.d,.p,.scan{animation:none!important}.scan{display:none}}'
       '</style>')

title = ('<title id="t">AYK rack 111: WireFlow finds 60 battery modules, 5 SSCs, 5 junction boxes, '
         '2 ACDPs and 1 MSM in the AutoCAD drawing</title>')
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-labelledby="t">{title}{css}'
       f'<rect width="100%" height="100%" fill="#0b1220"/>{lines}{scan}'
       f'<g font-family="Inter,system-ui,sans-serif">{"".join(out)}</g></svg>')
io.open(OUT, 'w', encoding='utf-8', newline='\n').write(svg)
print(OUT, len(svg), 'bytes;', len(out), 'parts;', len(keyframes), 'keyframe sets')
