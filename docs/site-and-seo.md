# Product page, app shell and SEO

## Routes

| Address | Shows |
|---|---|
| `/` (no hash), `#/`, `#features`, `#faq` … | Public product page (static HTML in `index.html`) |
| `#/app` | Drawings home: import a DXF, list of drawings, legacy projects |
| `#/cad/<id>` | CAD rack view (teach parts, confirm SSCs / ACDPs / MSM) |
| `#/project/<id>` | Legacy picture workspace |

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

- `assets/ayk-energy-logo.png` — AYK Energy logo (256 px, from the supplied
  `AYK LOGO-PNG.ico`). Shown on a white tile because the blue mark needs a light
  background on the dark theme: header, hero ("An AYK Energy product"), the
  large "Engineered by AYK Energy" panel, footer, app top bar and the social
  image. It is 256 px, so keep it at 200 px or smaller on screen.

The rack images were generated from `prototype-output/cad-check/rack-111.dxf`; they are
not mock-ups. Regenerate them if the recognition result changes.

## Claims on the page

Every number on the page was measured on drawing 111 (97,770 entities, 0.2 s
recognition, 240 terminals from 4 clicks, extents equal to AutoCAD's header
within 0.01 mm). Wiring on DXF is marked "next release" until it exists.
Do not add customer logos, testimonials or prices that are not real.

## Styles

- `site.css` — product page and the shared `btn-site` buttons / colour tokens.
- `styles.css` — app; the old sidebar was replaced by a top bar (`.topbar`),
  the Drawings home uses `.dash`, `.drop`, `.d-card`.
