# Local editor assets

Opening the visual editor in Commerce 0.1.4 requested GrapesJS's default Font
Awesome stylesheet from cdnjs. The 0.1.5 build serves the same icon CSS and
unmodified WOFF2 font from the installed plugin. The shared editor explicitly
selects that local stylesheet, and the WordPress build removes the vendor's
remote fallback. Shopify's shared editor receives the same bundled files.

The build includes the locked Font Awesome 4.7.0 dependency, original CSS
attribution, and full MIT/OFL license texts. Only the CSS font-face source is
changed to reference the local WOFF2. The engine remains Fullbleed 2.5.8 / Node
0.2.0; the PDF fonts, document templates and Pro 0.1.2 package are unchanged.

`tools/check-browser.py` blocks and records all off-origin HTTP requests while
generating a real PDF, opening the visual editor, editing and saving a template,
previewing it, reloading, downloading and resetting. It also loads the local
icon font and checks its glyph CSS. The disposable fixture disables WordPress's
own Gravatar option so that a core avatar request cannot obscure a plugin
regression. This changes only synthetic test data, not a merchant's settings.

The negative control installed the published 0.1.4 ZIP unchanged. It failed
on the exact cdnjs stylesheet request after its ordinary PDF download passed.
The release verification record retains the failure and the candidate's
browser results. The native WordPress directory job and Chrome, Firefox and
WebKit workflow jobs use the same network gate.

The separate public Playground capture can require local icons using
`--require-local-icons`; the former CDN is blocked during that check. Directory
screenshots remain native captures of the released plugin, with their version
and hashes recorded. This verification does not establish WordPress directory
approval or production readiness for the paid automation service.
