# Product page, app shell and SEO

## Routes

| Address | Shows |
|---|---|
| `/` (no hash), `#/`, `#features`, `#faq` … | Public product page (static HTML in `index.html`) |
| `#/app` | Projects: import a DXF, folders by project number |
| `#/folder/<id>` | Racks of one project (`none` = racks not in a project) |
| `#/cad/<id>` | Rack view (teach parts, confirm SSCs / ACDPs / MSM, number modules) |
| `#/sheet/<id>` | Wiring sheet editor and PDF download |
| `#/example` | Opens the bundled example rack 111 |

Only `#/<something>` routes belong to the app; plain anchors such as `#faq`
scroll the product page. `route()` in `js/app.js` toggles `#landing` and
`#app`.

## Why the product page is static

Search engines and link previews (Teams, Slack, LinkedIn) read the HTML that
the server returns; they do not run the app. The page content, headings,
FAQ, `<title>`, description, canonical URL, Open Graph / Twitter tags and the
JSON-LD (`SoftwareApplication`, `FAQPage`) are therefore all in
`index.html`. `robots.txt` and `sitemap.xml` sit at the site root.
The canonical/OG URLs use the GitHub Pages address from the README
(`https://dsarangi7.github.io/WireFlow/`); change them if the site moves.

## Images

- `assets/rack-111-recognised.svg` — the real 111 rack drawing (outlines
  ≥ 40 mm) with the recognised modules, SSCs, junction boxes, ACDPs and MSM,
  rendered from the DXF and the taught parts. 81 KB.
- `assets/og-wireflow.png` — 1200 × 630 social preview made from the same data.
- `assets/rack-111-animated.svg` — the hero picture: the same rack with the
  recognition replayed as a 12 s loop (scan line, modules column by column,
  terminals, junction boxes, SSCs with S, N, S+, B+, B−, S− coloured, ACDPs,
  MSM, labels). Made by `python tools/make-hero-animation.py` from
  `rack-111-recognised.svg`; regenerate it when that file changes. On the page
  it sits on a CSS 3D rack (`.rack3d` in `site.css`) that faces the viewer,
  sways, then makes one slow full turn every 26 s; the rear face says ACDPs and
  MSM are wired at the back. With *reduce motion* switched on, both the turn
  and the SVG animation stop and the finished picture is shown.

- `assets/ayk-energy-logo.png` — the logo (256 px, from the supplied
  `AYK LOGO-PNG.ico`), shown small on a white tile in the site header, the app
  top bar and the social image. The site does not carry a company byline:
  WireFlow is presented under its own name.

The rack images were generated from `prototype-output/cad-check/rack-111.dxf`; they are
not mock-ups. Regenerate them if the recognition result changes.

## Claims on the page

Every number on the page was measured on drawing 111 (97,770 entities, 0.2 s
recognition, 240 terminals from 4 clicks, extents equal to AutoCAD's header
within 0.01 mm). Wiring claims match `js/cadwire.js` and `tests/cadwire.test.js` (111: 140 cables, no power crossings).
Do not add customer logos, testimonials or prices that are not real.

## Styles

- `site.css` — product page and the shared `btn-site` buttons / colour tokens.
- `styles.css` — app; the old sidebar was replaced by a top bar (`.topbar`),
  the Drawings home uses `.dash`, `.drop`, `.d-card`.
