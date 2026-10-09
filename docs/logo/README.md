# App logo (draft 17e-1)

Horned calorie ring: the ring from `CalorieRing` (track plus used arc with round caps, starting at the top,
clockwise, about 83 % used) with two inward-curving horns. Horns and used arc are cut out of one red gradient
via an SVG mask, so the horns are part of the same color transition. The ring center sits 16 px (of 512) below
the icon center.

| File                    | Use                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `logo-light.svg`        | Light mode, rounded tile (rx 112), e.g. `logo.svg`, `favicon.svg`                           |
| `logo-dark.svg`         | Dark mode, rounded tile                                                                     |
| `logo-light-square.svg` | Full-bleed square for `apple-touch-icon` and the `any` PWA PNGs (the OS rounds the corners) |
| `logo-dark-square.svg`  | Full-bleed square, dark                                                                     |
| `logo-maskable.svg`     | Light, full-bleed, artwork scaled to 85 % for the PWA `maskable` icon                       |

Colors:

|                                          | Light                                         | Dark                   |
| ---------------------------------------- | --------------------------------------------- | ---------------------- |
| Tile gradient (top left to bottom right) | `#fefdfc` to `#ebe3de`                        | `#241f1d` to `#0f0d0c` |
| Track                                    | `#e9e2dd`                                     | `#2e2826`              |
| Red gradient (horns and arc)             | `#c0262e` to `#7d151b` (same as the old logo) | `#e5524f` to `#a3222b` |

The horn tips reach 216 px from the center, outside the maskable safe zone (radius 205), hence the separate
`logo-maskable.svg` (tips at about 184 px).
The mask uses the ids `t`, `g` and `m`; rename them when inlining several copies into one HTML page.

## Generated files

`pnpm --filter @ft/web icons` (`apps/web/scripts/icons.mjs`) renders the app files into `apps/web/public/`:
`logo.svg`/`logo-dark.svg` and `favicon.svg`/`favicon-dark.svg` (rounded tiles), `favicon.ico` (light),
`pwa-64/192/512` (light, manifest), `apple-touch-icon-180x180.png` and
`apple-touch-icon-dark-180x180.png`, `maskable-icon-512x512.png`. Run it after changing a file here.

Which variant shows is chosen per device under Mehr → Aussehen (`apps/web/src/lib/appearance.ts`): the in-app
logo, the favicon and the apple-touch-icon follow it. The web app manifest is static, so its icons stay light,
and iOS takes the home screen icon once, when the app is added to the home screen.
