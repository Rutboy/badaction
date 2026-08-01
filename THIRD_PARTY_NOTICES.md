# Third-Party Notices

This file preserves notices for third-party material copied into the project,
requiring separate attribution, or embedded in the user interface. The
`npm run check:licenses` command verifies allowed SPDX identifiers for all
lockfile packages. The build also generates
`third-party-licenses/manifest.json` with notices for the complete non-optional
production dependency closure, externalized standalone packages, and the full
upstream set of notices for Next.js compiled components. The bundle is
intentionally over-inclusive so compiled or traced code does not lose its
corresponding notice. When an npm tarball declares a license but omits its full
notice, an explicitly reviewed upstream copy is stored in
`third-party-licenses/`; introducing another missing notice fails the build.

## License fallback provenance

The `react-remove-scroll-bar@2.3.8` npm tarball declares MIT but omits the full
text. Its reviewed [upstream LICENSE](https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE)
is retained in `third-party-licenses/react-remove-scroll-bar.LICENSE` and copied
into the standalone notice bundle. A small explicit set of Radix utility
tarballs has the same omission; their package metadata points to the Radix
Primitives monorepo, so the build copies the identical MIT notice shipped by
the installed Radix packages. Both fallback sets are fail-closed in the build
script rather than inferred from an arbitrary package with the same SPDX name.

## caniuse-lite

The standalone artifact includes unmodified browser compatibility data from the
version of `caniuse-lite` pinned in `package-lock.json`.

- Creator: Ben Briggs (<http://beneb.info>)
- Source: <https://github.com/browserslist/caniuse-lite>
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)

This material is included transitively through Next.js. Badaction contributors
do not claim endorsement by the `caniuse-lite` copyright holder.

## shadcn/ui

Components in `src/components/ui` are based on shadcn/ui and adapted for this
project.

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Source: <https://github.com/shadcn-ui/ui>

## Lucide Icons and Feather-derived icons

The interface uses SVG icons from `lucide-react`. Some of the Lucide icons in use
are derived from Feather, so both upstream notices are preserved.

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture,
arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down,
arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle,
arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check,
chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down,
chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code,
columns, command, compass, corner-down-left, corner-down-right,
corner-left-down, corner-left-up, corner-right-down, corner-right-up,
corner-up-left, corner-up-right, crosshair, database, divide-circle,
divide-square, dollar-sign, download, external-link, feather, frown, hash,
headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link,
loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle,
minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music,
navigation-2, navigation, octagon, pause-circle, percent, plus-circle,
plus-square, plus, power, radio, rss, search, server, share, shopping-bag,
sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2,
trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in,
zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Source: <https://github.com/lucide-icons/lucide>
