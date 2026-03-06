# 🌍 GeoGuessr Revealer

An automatic overlay extension for Chrome, Edge, Brave, and other Chromium browsers that reveals the exact location during GeoGuessr games. No console pasting, no bookmarklets — just install and play.

![Edge Extension](https://img.shields.io/badge/Platform-Microsoft_Edge-0078D7?style=flat-square&logo=microsoftedge&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-4f46e5?style=flat-square)
![Version](https://img.shields.io/badge/Version-3.0-a855f7?style=flat-square)

---

## ⚡ Quick Install

1. Open Chrome (`chrome://extensions/`) or Edge (`edge://extensions/`)
2. Enable **Developer mode** (toggle at top-right for Chrome, bottom-left for Edge)
3. Click **Load unpacked**
4. Select the **`extension/`** folder from this project
5. Done — visit [geoguessr.com](https://www.geoguessr.com) and the overlay appears automatically

---

## 🎯 Features

| Feature | Description |
|---------|-------------|
| **Auto-inject** | Overlay appears automatically on every GeoGuessr page |
| **8 Detection Methods** | Google Maps API, prototype hooks, network interception, SV instances, Next.js data, React state, tile URLs, script data |
| **Round Auto-detect** | Automatically resets when you move to a new round |
| **Reverse Geocoding** | Shows country (with flag), city, region, and full address |
| **Map Preview** | Satellite mini-map embedded in the panel |
| **Camera Metadata** | Heading, pitch, zoom, panorama ID |
| **Round History** | Logs every round with country flags and coordinates |
| **Draggable Panel** | Move it anywhere on screen |
| **Keyboard Shortcuts** | `G` toggle · `C` copy · `M` open maps · `R` refresh |

---

## 📁 Project Structure

```
GEO/
├── README.md
└── extension/
    ├── manifest.json      # Manifest V3 configuration
    ├── injector.js         # Content script — injects hack.js at document_start
    ├── hack.js             # Core: 8 detectors + overlay UI + round tracking
    ├── popup.html          # Extension popup (status & shortcuts reference)
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `G` | Toggle overlay panel |
| `C` | Copy coordinates to clipboard |
| `M` | Open location in Google Maps |
| `R` | Force refresh / re-scan |

---

## 🔧 How It Works

The extension injects `hack.js` into every GeoGuessr page at `document_start` via `injector.js`. This allows network interception before the page loads, capturing coordinates from API responses immediately.

**Detection priority:**
1. **Google Maps API** — direct `StreetViewPanorama.getPosition()` (99% confidence)
2. **Prototype Hooks** — `setPosition`/`setPano` hooks (97%)
3. **SV Instances** — tracked StreetViewPanorama objects (96%)
4. **Network Interception** — `fetch`/`XHR` response parsing (92%)
5. **Next.js Data** — `__NEXT_DATA__` JSON parsing (90%)
6. **React State** — React Fiber tree traversal (88%)
7. **Tile URLs** — Google Maps image tile URL parsing (85%)
8. **Script Data** — inline `<script>` tag scanning (78%)

**Round change detection** monitors URL changes, DOM round indicators, and panorama IDs — automatically clearing stale data when you move to a new round.

---

## ⚠️ Notes

- This is for **educational and entertainment purposes only**
- Works on Chrome, Edge, Brave, and most other Chromium-based browsers
- Reverse geocoding uses the free [OpenStreetMap Nominatim API](https://nominatim.org/)
- No data is collected or sent to any third-party servers beyond Nominatim

---

## 🔄 Updating

After editing any files in `extension/`, go to `chrome://extensions/` or `edge://extensions/` and click the **refresh** icon on the extension card.
