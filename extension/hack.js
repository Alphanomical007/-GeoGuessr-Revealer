// ============================================================
//  🌍 GeoGuessr Revealer v3.2 — Extension Edition
//  Auto-injected by the extension. No console pasting needed!
//  Press [G] to toggle the overlay panel.
// ============================================================

(function () {
    "use strict";

    const ID = "geo-revealer-ext";
    if (document.getElementById(ID)) return;

    // ═══════════════════════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════════════════════
    const S = {
        lat: null, lng: null,
        heading: null, pitch: null, panoId: null, zoom: null,
        country: "", countryCode: "", region: "", city: "", road: "",
        roundHistory: [], roundNum: 0, lastKey: "", found: false,
        minimized: false, geocoding: false, geocodeFailed: false,
        detectionMethod: "", confidence: 0,
    };

    // ═══════════════════════════════════════════════════════════
    //  ROUND-CHANGE DETECTION — clears stale data automatically
    // ═══════════════════════════════════════════════════════════
    let _prevUrl = location.href;
    let _prevPanoId = null;
    let _prevRoundIndicator = "";
    let _roundResetCooldown = 0;
    let _dataTimestamp = 0;  // When the current round's data was first captured

    function detectRoundChange() {
        let changed = false;

        // 1) URL changed (navigation between rounds / games)
        if (location.href !== _prevUrl) {
            _prevUrl = location.href;
            changed = true;
        }

        // 2) Round indicator in DOM changed (e.g. "Round 2 / 5")
        const roundEl = document.querySelector(
            '[data-qa="round-number"], .round-number, [class*="round-number"], ' +
            '[class*="RoundNumber"], [class*="round_number"], [data-qa="round"]'
        );
        if (roundEl) {
            const txt = roundEl.textContent.trim();
            if (txt && txt !== _prevRoundIndicator) {
                _prevRoundIndicator = txt;
                changed = true;
            }
        }

        // 3) Panorama ID changed — the most reliable round-change signal
        const currentPano = _getLivePanoId();
        if (currentPano && currentPano !== _prevPanoId) {
            // If we had a previous pano, this is definitely a new round
            if (_prevPanoId) {
                changed = true;
            }
            _prevPanoId = currentPano;
        }

        // 4) Results/summary screen detection (no panorama visible = between rounds)
        const isOnResultsPage = !document.querySelector('canvas, [class*="panorama"], [class*="Panorama"]')
            && (location.href.includes('/results') || location.href.includes('/summary'));
        if (isOnResultsPage && S.found) {
            changed = true;
        }

        // Cooldown: don't reset more than once per 800ms
        if (changed && Date.now() - _roundResetCooldown > 800) {
            _roundResetCooldown = Date.now();
            _clearStaleData();
        }
    }

    // ── Cached __gm element (avoids scanning entire DOM every loop) ──
    let _cachedGmEl = null;
    let _gmScanCount = 0;

    function _findGmElement() {
        // Return cached element if it's still in the DOM
        if (_cachedGmEl && document.contains(_cachedGmEl) && _cachedGmEl.__gm) {
            return _cachedGmEl;
        }
        _cachedGmEl = null;
        // Scan DOM to find a __gm element — limit to divs (Google Maps containers are divs)
        try {
            const divs = document.querySelectorAll('div');
            for (let i = 0; i < divs.length; i++) {
                if (divs[i].__gm) {
                    _cachedGmEl = divs[i];
                    return _cachedGmEl;
                }
            }
        } catch (e) { }
        return null;
    }

    // Clean dead SV instances periodically
    function _cleanSVInstances() {
        if (!window.__GH?.sv?.length) return;
        const alive = [];
        for (const sv of window.__GH.sv) {
            try {
                // Test if instance is still alive by calling a method
                sv.getPosition?.();
                alive.push(sv);
            } catch (e) { /* dead instance */ }
        }
        window.__GH.sv = alive;
    }
    // Run cleanup every 30 seconds
    setInterval(_cleanSVInstances, 30000);

    function _getLivePanoId() {
        // Try cached SV instances first
        for (const sv of (window.__GH?.sv || [])) {
            try {
                const p = sv.getPano?.();
                if (p) return p;
            } catch (e) { }
        }
        // Try cached __gm element
        const gmEl = _findGmElement();
        if (gmEl) {
            try {
                const sv = gmEl.__gm.map?.getStreetView?.();
                const p = sv?.getPano?.();
                if (p) return p;
            } catch (e) { }
        }
        return null;
    }

    function _clearStaleData() {
        // Clear ALL cached hook data so fresh data is required
        if (window.__GH) {
            window.__GH.net = null;
            window.__GH.netTime = 0;
            window.__GH.pano = null;
            window.__GH.panoTime = 0;
        }
        // Invalidate cached __gm element — forces re-scan
        _cachedGmEl = null;
        // Reset data timestamp
        _dataTimestamp = 0;
        // Clear state so UI shows "searching" again
        S.lat = null; S.lng = null;
        S.found = false;
        S.lastKey = "";
        S.country = ""; S.countryCode = "";
        S.region = ""; S.city = ""; S.road = "";
        S.heading = null; S.pitch = null; S.panoId = null; S.zoom = null;
        S.detectionMethod = ""; S.confidence = 0;
    }

    // Wait for full page before building UI (with timeout fallback)
    function waitForBody(cb) {
        let called = false;
        function once() { if (called) return; called = true; cb(); }
        if (document.body) return once();
        // Try MutationObserver if documentElement exists
        if (document.documentElement) {
            const obs = new MutationObserver(() => {
                if (document.body) { obs.disconnect(); once(); }
            });
            obs.observe(document.documentElement, { childList: true });
        }
        // Fallback: poll + DOMContentLoaded
        const fallback = setInterval(() => {
            if (document.body) { clearInterval(fallback); once(); }
        }, 50);
        document.addEventListener("DOMContentLoaded", () => {
            clearInterval(fallback);
            if (document.body) once();
        }, { once: true });
        // Hard timeout at 10s
        setTimeout(() => { clearInterval(fallback); if (document.body) once(); }, 10000);
    }

    // ═══════════════════════════════════════════════════════════
    //  NETWORK INTERCEPTION (runs immediately at document_start)
    // ═══════════════════════════════════════════════════════════
    window.__GH = window.__GH || { net: null, netTime: 0, pano: null, panoTime: 0, sv: [], protoHooked: false, netHooked: false };

    function isGameUrl(url) {
        if (!url) return false;
        const u = url.toLowerCase();
        return u.includes("/api/") || u.includes("game") || u.includes("round") ||
            u.includes("challenge") || u.includes("duels") || u.includes("battle-royale") ||
            u.includes("streak") || u.includes("quiz") || u.includes("maps.googleapis.com");
    }

    function isValid(lat, lng) {
        return typeof lat === "number" && typeof lng === "number" &&
            !isNaN(lat) && !isNaN(lng) &&
            Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
            (Math.abs(lat) > 0.01 || Math.abs(lng) > 0.01);
    }

    function isMapCenter(lat, lng) {
        return (lat === 0 && lng === 0) ||
            (Math.abs(lat - 30) < 0.01 && Math.abs(lng) < 0.01) ||
            (Math.abs(lat - 20) < 0.01 && Math.abs(lng) < 0.01);
    }

    function deepFindCoords(obj, depth, seen) {
        if (depth > 8 || !obj || typeof obj !== "object") return null;
        // Circular reference guard
        if (!seen) seen = new WeakSet();
        try { if (seen.has(obj)) return null; seen.add(obj); } catch (e) { return null; }
        if (typeof obj.lat === "number" && typeof obj.lng === "number" && isValid(obj.lat, obj.lng) && !isMapCenter(obj.lat, obj.lng)) {
            return { lat: obj.lat, lng: obj.lng };
        }
        let keys;
        try { keys = Object.keys(obj); } catch (e) { return null; }
        const priorityKeys = ["lat", "lng", "latitude", "longitude", "coordinate", "location", "position", "latlng", "round", "rounds"];
        for (const key of keys) {
            try {
                if (priorityKeys.some(k => key.toLowerCase().includes(k))) {
                    const r = deepFindCoords(obj[key], depth + 1, seen);
                    if (r) return r;
                }
            } catch (e) { }
        }
        if (Array.isArray(obj)) {
            for (const item of obj) { try { const r = deepFindCoords(item, depth + 1, seen); if (r) return r; } catch (e) { } }
        }
        for (const key of keys) {
            try { const r = deepFindCoords(obj[key], depth + 1, seen); if (r) return r; } catch (e) { }
        }
        return null;
    }

    function parseNetworkPayload(text) {
        try {
            // Skip huge payloads (images, assets, etc.)
            if (!text || text.length > 500000) return;
            const patterns = [
                /"lat"\s*:\s*(-?\d+\.?\d*)\s*,\s*"lng"\s*:\s*(-?\d+\.?\d*)/g,
                /"latitude"\s*:\s*(-?\d+\.?\d*)\s*,\s*"longitude"\s*:\s*(-?\d+\.?\d*)/g,
                /\blat\b[":=\s]+(-?\d+\.\d{3,})[,\s"&]+\blng\b[":=\s]+(-?\d+\.\d{3,})/g,
            ];
            for (const pat of patterns) {
                let match;
                while ((match = pat.exec(text)) !== null) {
                    const lat = parseFloat(match[1]), lng = parseFloat(match[2]);
                    if (isValid(lat, lng) && !isMapCenter(lat, lng)) {
                        window.__GH.net = { lat, lng };
                        window.__GH.netTime = Date.now();
                        return;
                    }
                }
            }
            try {
                const json = JSON.parse(text);
                const found = deepFindCoords(json, 0);
                if (found) { window.__GH.net = found; window.__GH.netTime = Date.now(); }
            } catch (e) { }
        } catch (e) { }
    }

    // Intercept immediately
    if (!window.__GH.netHooked) {
        const origFetch = window.fetch;
        window.fetch = function () {
            const url = typeof arguments[0] === "string" ? arguments[0] : arguments[0]?.url || "";
            const p = origFetch.apply(this, arguments);
            // Only wrap in .then if it's a game-related URL
            if (isGameUrl(url)) {
                return p.then((res) => {
                    try { res.clone().text().then((t) => parseNetworkPayload(t)).catch(() => { }); } catch (e) { }
                    return res;
                }).catch((err) => { throw err; }); // Re-throw so callers see the error
            }
            return p;
        };

        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) {
            this.__url = u;
            return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
            this.addEventListener("load", function () {
                try {
                    if (isGameUrl(this.__url)) parseNetworkPayload(this.responseText);
                } catch (e) { }
            });
            return origSend.apply(this, arguments);
        };

        window.__GH.netHooked = true;
    }

    // ═══════════════════════════════════════════════════════════
    //  GOOGLE MAPS API HOOKS (set up when google loads)
    // ═══════════════════════════════════════════════════════════
    function setupProtoHooks() {
        if (window.__GH.protoHooked) return;
        const interval = setInterval(() => {
            if (!window.google?.maps?.StreetViewPanorama) return;
            clearInterval(interval);

            const SVP = google.maps.StreetViewPanorama.prototype;

            const origSetPos = SVP.setPosition;
            SVP.setPosition = function (pos) {
                try {
                    const lat = typeof pos.lat === "function" ? pos.lat() : pos.lat;
                    const lng = typeof pos.lng === "function" ? pos.lng() : pos.lng;
                    if (isValid(lat, lng)) { window.__GH.pano = { lat, lng }; window.__GH.panoTime = Date.now(); }
                } catch (e) { }
                return origSetPos.apply(this, arguments);
            };

            const origSetPano = SVP.setPano;
            SVP.setPano = function () {
                const result = origSetPano.apply(this, arguments);
                try {
                    setTimeout(() => {
                        const pos = this.getPosition?.();
                        if (pos) {
                            const lat = pos.lat(), lng = pos.lng();
                            if (isValid(lat, lng)) {
                                window.__GH.pano = { lat, lng }; window.__GH.panoTime = Date.now();
                                try {
                                    const pov = this.getPov?.();
                                    S.heading = pov?.heading; S.pitch = pov?.pitch;
                                    S.zoom = this.getZoom?.(); S.panoId = this.getPano?.();
                                } catch (e) { }
                            }
                        }
                    }, 80);
                } catch (e) { }
                return result;
            };

            // Listen on all instances
            const origCtor = google.maps.StreetViewPanorama;
            const handler = {
                construct(target, args) {
                    const instance = new target(...args);
                    window.__GH.sv.push(instance);
                    try {
                        google.maps.event.addListener(instance, "position_changed", () => {
                            try {
                                const pos = instance.getPosition();
                                if (pos) {
                                    const lat = pos.lat(), lng = pos.lng();
                                    if (isValid(lat, lng)) {
                                        window.__GH.pano = { lat, lng }; window.__GH.panoTime = Date.now();
                                        try {
                                            const pov = instance.getPov?.();
                                            S.heading = pov?.heading; S.pitch = pov?.pitch;
                                            S.zoom = instance.getZoom?.(); S.panoId = instance.getPano?.();
                                        } catch (e) { }
                                    }
                                }
                            } catch (e) { }
                        });
                        google.maps.event.addListener(instance, "pov_changed", () => {
                            try {
                                const pov = instance.getPov?.();
                                S.heading = pov?.heading; S.pitch = pov?.pitch;
                            } catch (e) { }
                        });
                    } catch (e) { }
                    return instance;
                }
            };

            try {
                google.maps.StreetViewPanorama = new Proxy(origCtor, handler);
                google.maps.StreetViewPanorama.prototype = origCtor.prototype;
            } catch (e) { }

            window.__GH.protoHooked = true;
        }, 150);
    }
    setupProtoHooks();

    // ═══════════════════════════════════════════════════════════
    //  COORDINATE FINDERS
    // ═══════════════════════════════════════════════════════════
    function tryGoogleMapsAPI() {
        try {
            if (!window.google?.maps) return null;
            // Use cached __gm element (much faster than scanning all elements)
            const gmEl = _findGmElement();
            if (!gmEl) return null;
            const paths = [
                () => gmEl.__gm.map?.getStreetView?.()?.getPosition?.(),
                () => gmEl.__gm.map?.streetView_?.getPosition?.(),
            ];
            for (const p of paths) {
                try {
                    const pos = p();
                    if (pos && typeof pos.lat === "function") {
                        const lat = pos.lat(), lng = pos.lng();
                        if (isValid(lat, lng)) {
                            try {
                                const sv = gmEl.__gm.map.getStreetView();
                                const pov = sv.getPov(); S.heading = pov?.heading; S.pitch = pov?.pitch;
                                S.zoom = sv.getZoom?.(); S.panoId = sv.getPano?.();
                            } catch (e) { }
                            return { lat, lng, method: "Google Maps API", confidence: 99 };
                        }
                    }
                } catch (e) { }
            }
        } catch (e) { }
        return null;
    }

    // Max age for cached hook data (20 seconds) — prevents stale round data
    const DATA_MAX_AGE = 20000;

    function tryProtoHookData() {
        if (!window.__GH.pano || !isValid(window.__GH.pano.lat, window.__GH.pano.lng)) return null;
        // Auto-expire stale data
        if (window.__GH.panoTime && (Date.now() - window.__GH.panoTime > DATA_MAX_AGE)) {
            window.__GH.pano = null; window.__GH.panoTime = 0;
            return null;
        }
        return { ...window.__GH.pano, method: "API Hook", confidence: 97 };
    }

    function trySVInstances() {
        try {
            for (const sv of (window.__GH.sv || [])) {
                try {
                    const pos = sv.getPosition?.();
                    if (pos) {
                        const lat = pos.lat(), lng = pos.lng();
                        if (isValid(lat, lng)) {
                            try { const pov = sv.getPov?.(); S.heading = pov?.heading; S.pitch = pov?.pitch; S.zoom = sv.getZoom?.(); S.panoId = sv.getPano?.(); } catch (e) { }
                            return { lat, lng, method: "SV Instance", confidence: 96 };
                        }
                    }
                } catch (e) { }
            }
        } catch (e) { }
        return null;
    }

    function tryNetworkData() {
        if (!window.__GH.net || !isValid(window.__GH.net.lat, window.__GH.net.lng)) return null;
        // Auto-expire stale data
        if (window.__GH.netTime && (Date.now() - window.__GH.netTime > DATA_MAX_AGE)) {
            window.__GH.net = null; window.__GH.netTime = 0;
            return null;
        }
        return { ...window.__GH.net, method: "Network", confidence: 92 };
    }

    function tryNextData() {
        try {
            const el = document.getElementById("__NEXT_DATA__");
            if (!el) return null;
            const data = JSON.parse(el.textContent);
            const found = deepFindCoords(data, 0);
            if (found) return { ...found, method: "Next.js", confidence: 90 };
        } catch (e) { }
        return null;
    }

    // Safe stringify that handles circular references
    function safeStringify(obj, limit) {
        const seen = new WeakSet();
        let len = 0;
        try {
            return JSON.stringify(obj, function (key, value) {
                if (len > limit) return undefined;
                if (typeof value === "object" && value !== null) {
                    if (seen.has(value)) return "[circular]";
                    seen.add(value);
                }
                len += String(value).length;
                return value;
            });
        } catch (e) { return ""; }
    }

    function tryReactState() {
        try {
            const rootEl = document.getElementById("__next") || document.getElementById("root");
            if (!rootEl) return null;
            const fKey = Object.keys(rootEl).find(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
            if (!fKey) return null;
            let fiber = rootEl[fKey], i = 0;
            while (fiber && i < 400) {
                i++;
                try {
                    const s = fiber.memoizedState;
                    if (s) {
                        const str = safeStringify(s, 40000);
                        if (str) {
                            const m = str.match(/"lat"\s*:\s*(-?\d+\.\d{3,})\s*,\s*"lng"\s*:\s*(-?\d+\.\d{3,})/);
                            if (m) {
                                const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
                                if (isValid(lat, lng) && !isMapCenter(lat, lng))
                                    return { lat, lng, method: "React State", confidence: 88 };
                            }
                        }
                    }
                } catch (e) { }
                fiber = fiber.child || fiber.sibling || fiber.return?.sibling;
            }
        } catch (e) { }
        return null;
    }

    function tryMetaTiles() {
        try {
            const imgs = document.querySelectorAll("img[src*='maps.googleapis.com'], img[src*='cbk0.google.com'], img[src*='streetviewpixels']");
            for (const img of imgs) {
                const latM = img.src.match(/[&?]lat=(-?\d+\.?\d*)/);
                const lngM = img.src.match(/[&?]lng=(-?\d+\.?\d*)/);
                if (latM && lngM) {
                    const lat = parseFloat(latM[1]), lng = parseFloat(lngM[1]);
                    if (isValid(lat, lng)) return { lat, lng, method: "Tile URL", confidence: 85 };
                }
            }
        } catch (e) { }
        return null;
    }

    function tryGlobals() {
        try {
            const scripts = document.querySelectorAll("script:not([src])");
            for (const sc of scripts) {
                if (sc.id === "__NEXT_DATA__" || sc.textContent.length > 300000) continue;
                const m = sc.textContent.match(/"lat"\s*:\s*(-?\d+\.\d{3,})\s*,\s*"lng"\s*:\s*(-?\d+\.\d{3,})/);
                if (m) {
                    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
                    if (isValid(lat, lng) && !isMapCenter(lat, lng))
                        return { lat, lng, method: "Script Data", confidence: 78 };
                }
            }
        } catch (e) { }
        return null;
    }

    function findCoordinates() {
        return tryGoogleMapsAPI() || tryProtoHookData() || trySVInstances() || tryNetworkData()
            || tryNextData() || tryReactState() || tryMetaTiles() || tryGlobals();
    }

    // ═══════════════════════════════════════════════════════════
    //  GEOCODING
    // ═══════════════════════════════════════════════════════════
    let geoTimer = null;
    let _geoRetries = 0;
    const _GEO_MAX_RETRIES = 2;
    function ccToFlag(cc) {
        if (!cc || cc.length !== 2) return "🏳️";
        try {
            return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
        } catch (e) { return "🏳️"; }
    }
    async function geocode(lat, lng) {
        S.geocodeFailed = false;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=en`,
                { signal: controller.signal }
            );
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data || data.error) throw new Error(data?.error || "empty response");
            const a = data.address || {};
            S.country = a.country || "";
            S.countryCode = a.country_code || "";
            S.region = a.state || a.region || a.province || "";
            S.city = a.city || a.town || a.village || a.municipality || a.county || "";
            S.road = data.display_name || "";
            _geoRetries = 0;
        } catch (e) {
            if (_geoRetries < _GEO_MAX_RETRIES) {
                _geoRetries++;
                await new Promise(r => setTimeout(r, 1500 * _geoRetries));
                return geocode(lat, lng); // retry recursively
            }
            _geoRetries = 0;
            S.geocodeFailed = true;
            S.country = "Unknown";
        }
        // Always update UI when done (success or final failure)
        S.geocoding = false;
        window.__grUpdateLocUI?.();
    }

    // ═══════════════════════════════════════════════════════════
    //  BUILD THE OVERLAY UI (waits for body)
    // ═══════════════════════════════════════════════════════════
    waitForBody(buildUI);

    function buildUI() {
        // Styles
        const css = document.createElement("style");
        css.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap');

      #${ID}{position:fixed;top:16px;right:16px;z-index:2147483647;font-family:'Inter',system-ui,-apple-system,sans-serif;pointer-events:auto;user-select:none}
      #${ID} *{box-sizing:border-box;margin:0;padding:0}

      .gr-panel{
        width:350px;background:rgba(12,12,30,.92);
        backdrop-filter:blur(50px) saturate(1.6);-webkit-backdrop-filter:blur(50px) saturate(1.6);
        border:1px solid rgba(255,255,255,.07);border-radius:16px;overflow:hidden;
        box-shadow:0 0 0 .5px rgba(255,255,255,.04),0 25px 50px -12px rgba(0,0,0,.8),0 0 100px -30px rgba(99,102,241,.12),inset 0 1px 0 rgba(255,255,255,.04);
        transition:all .35s cubic-bezier(.32,0,.67,0);transform-origin:top right;
        animation:grSlideIn .4s cubic-bezier(.32,0,.67,0);
      }
      .gr-panel.gr-hidden{transform:scale(0) translateX(180px) translateY(-80px);opacity:0;pointer-events:none}
      @keyframes grSlideIn{from{opacity:0;transform:translateY(-12px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}

      .gr-hdr{
        background:linear-gradient(135deg,#4338ca 0%,#6d28d9 40%,#a855f7 100%);
        padding:14px 16px;display:flex;align-items:center;justify-content:space-between;
        cursor:grab;position:relative;overflow:hidden;
      }
      .gr-hdr::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.06) 50%,transparent 100%);background-size:200% 100%;animation:grShimmer 3s ease-in-out infinite}
      @keyframes grShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
      .gr-hdr:active{cursor:grabbing}
      .gr-hdr-l{display:flex;align-items:center;gap:12px;position:relative}
      .gr-logo{width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.15);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,.2)}
      .gr-ttl{color:#fff;font-size:15px;font-weight:800;letter-spacing:.3px;text-shadow:0 1px 3px rgba(0,0,0,.2)}
      .gr-ver{color:rgba(255,255,255,.55);font-size:10px;font-weight:500;margin-top:1px}
      .gr-btns{display:flex;gap:6px;position:relative}
      .gr-hb{width:30px;height:30px;border-radius:8px;border:none;background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all .2s ease;backdrop-filter:blur(8px)}
      .gr-hb:hover{background:rgba(255,255,255,.2);color:#fff;transform:scale(1.08)}
      .gr-hb:active{transform:scale(.95)}

      .gr-sbar{padding:10px 16px;display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.3);border-bottom:1px solid rgba(255,255,255,.04);position:relative;overflow:hidden}
      .gr-sbar-prog{position:absolute;bottom:0;left:0;height:2px;background:linear-gradient(90deg,#6366f1,#a855f7);transition:width .5s ease;border-radius:0 1px 1px 0}
      .gr-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;transition:all .4s ease}
      .gr-dot.s{background:#fbbf24;box-shadow:0 0 12px rgba(251,191,36,.5);animation:grPulse 1.5s ease-in-out infinite}
      .gr-dot.l{background:#34d399;box-shadow:0 0 12px rgba(52,211,153,.5)}
      .gr-dot.e{background:#f87171;box-shadow:0 0 12px rgba(248,113,113,.5)}
      @keyframes grPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
      .gr-smsg{color:rgba(255,255,255,.5);font-size:11px;font-weight:500;letter-spacing:.1px}
      .gr-mtag{margin-left:auto;padding:3px 8px;border-radius:20px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;background:rgba(99,102,241,.12);color:#a5b4fc;border:1px solid rgba(99,102,241,.15)}

      .gr-body{padding:14px 16px;display:flex;flex-direction:column;gap:12px}

      .gr-map{width:100%;border-radius:12px;overflow:hidden;position:relative;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.05);transition:height .3s ease}
      .gr-map.sm{height:140px}
      .gr-map.lg{height:260px}
      .gr-map iframe{width:100%;height:100%;border:none;opacity:.9;transition:opacity .5s ease}
      .gr-map .gr-mo{position:absolute;bottom:0;left:0;right:0;height:30px;background:linear-gradient(180deg,transparent 0%,rgba(12,12,30,.6) 100%);pointer-events:none}
      .gr-ml{position:absolute;bottom:8px;right:8px;background:rgba(99,102,241,.85);color:#fff;text-decoration:none;padding:5px 12px;border-radius:20px;font-size:10px;font-weight:600;backdrop-filter:blur(8px);transition:all .2s ease;letter-spacing:.2px;box-shadow:0 2px 8px rgba(0,0,0,.3);z-index:2}
      .gr-ml:hover{background:rgba(99,102,241,1);transform:translateY(-1px);box-shadow:0 4px 12px rgba(99,102,241,.4)}
      .gr-mzb{position:absolute;top:8px;right:8px;width:26px;height:26px;border-radius:7px;border:none;background:rgba(255,255,255,.1);color:rgba(255,255,255,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all .2s ease;z-index:2;backdrop-filter:blur(8px)}
      .gr-mzb:hover{background:rgba(255,255,255,.2);color:#fff;transform:scale(1.08)}
      .gr-mph{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:rgba(255,255,255,.1);font-size:28px}
      .gr-mph span{font-size:11px;font-weight:500;color:rgba(255,255,255,.15)}

      .gr-cc{background:linear-gradient(135deg,rgba(79,70,229,.08),rgba(139,92,246,.06));border:1px solid rgba(99,102,241,.1);border-radius:12px;padding:14px 16px;position:relative;overflow:hidden}
      .gr-cc::before{content:'';position:absolute;top:-60%;right:-40%;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(139,92,246,.08) 0%,transparent 70%);pointer-events:none}
      .gr-ccl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:rgba(255,255,255,.3);margin-bottom:8px}
      .gr-ccv{font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;color:#67e8f9;letter-spacing:.3px;position:relative;text-shadow:0 0 20px rgba(103,232,249,.15)}
      .gr-ccb{position:absolute;top:12px;right:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:rgba(255,255,255,.4);width:32px;height:32px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .2s ease;z-index:1}
      .gr-ccb:hover{background:rgba(99,102,241,.2);color:#fff;transform:scale(1.08);border-color:rgba(99,102,241,.3)}
      .gr-ccb:active{transform:scale(.95)}

      .gr-lg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .gr-li{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);border-radius:10px;padding:10px 12px;transition:background .2s ease}
      .gr-li:hover{background:rgba(255,255,255,.035)}
      .gr-li.f{grid-column:1/-1}
      .gr-lic{font-size:16px;margin-bottom:3px}
      .gr-lik{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.25);margin-bottom:2px}
      .gr-liv{font-size:13px;font-weight:600;color:#e2e8f0;line-height:1.4;word-break:break-word;transition:color .3s ease}
      .gr-liv.gc{font-size:16px;font-weight:800;background:linear-gradient(135deg,#fbbf24,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
      .gr-liv.loading{color:rgba(255,255,255,.2);font-style:italic}

      .gr-cr{display:flex;gap:1px;border-radius:10px;overflow:hidden;background:rgba(255,255,255,.03)}
      .gr-chip{flex:1;padding:8px 4px;text-align:center;background:rgba(255,255,255,.02);transition:background .2s ease}
      .gr-chip:hover{background:rgba(255,255,255,.04)}
      .gr-chl{font-size:8px;color:rgba(255,255,255,.3);font-weight:600;text-transform:uppercase;letter-spacing:.6px}
      .gr-chv{font-family:'JetBrains Mono',monospace;font-size:11px;color:#c4b5fd;font-weight:600;margin-top:2px}

      .gr-acts{display:flex;gap:6px}
      .gr-ab{flex:1;padding:10px 0;border:none;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;transition:all .2s ease;display:flex;align-items:center;justify-content:center;gap:4px;letter-spacing:.2px}
      .gr-ab:active{transform:scale(.97)}
      .gr-ap{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;box-shadow:0 2px 10px rgba(99,102,241,.25)}
      .gr-ap:hover{box-shadow:0 4px 16px rgba(99,102,241,.35);filter:brightness(1.1)}
      .gr-sv{background:linear-gradient(135deg,#059669,#10b981);color:#fff;box-shadow:0 2px 10px rgba(16,185,129,.25)}
      .gr-sv:hover{box-shadow:0 4px 16px rgba(16,185,129,.35);filter:brightness(1.1)}
      .gr-as{background:rgba(255,255,255,.04);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.06)}
      .gr-as:hover{background:rgba(255,255,255,.07);color:#fff}

      .gr-hist{margin-top:0}
      .gr-ht{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:rgba(255,255,255,.2);margin-bottom:6px}
      .gr-hl{display:flex;flex-direction:column;gap:4px;max-height:100px;overflow-y:auto}
      .gr-hi{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:rgba(255,255,255,.015);border:1px solid rgba(255,255,255,.025);font-size:11px;transition:all .2s ease}
      .gr-hi:hover{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.05)}
      .gr-hn{width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,rgba(99,102,241,.15),rgba(139,92,246,.15));color:#a5b4fc;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;flex-shrink:0}
      .gr-hf{font-size:15px;flex-shrink:0}
      .gr-hna{color:#cbd5e1;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .gr-hco{font-family:'JetBrains Mono',monospace;font-size:9px;color:rgba(255,255,255,.2);flex-shrink:0}

      .gr-kbd{padding:8px 16px;text-align:center;background:rgba(0,0,0,.2);border-top:1px solid rgba(255,255,255,.03);display:flex;align-items:center;justify-content:center;gap:3px}
      .gr-k{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:5px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);border-bottom:2px solid rgba(255,255,255,.1);font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,.35);font-weight:600}
      .gr-kt{color:rgba(255,255,255,.15);font-size:9px;margin:0 4px;font-weight:500}

      .gr-fab{position:fixed;bottom:20px;right:20px;z-index:2147483647;width:48px;height:48px;border-radius:14px;border:none;background:linear-gradient(135deg,#4f46e5,#a855f7);color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 20px rgba(99,102,241,.5),0 0 0 .5px rgba(255,255,255,.1);display:none;align-items:center;justify-content:center;transition:all .25s ease;animation:grPop .3s cubic-bezier(.32,0,.67,0)}
      .gr-fab:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(99,102,241,.6)}
      .gr-fab:active{transform:scale(.95)}
      .gr-fab.v{display:flex}
      @keyframes grPop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}

      .gr-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);background:rgba(20,20,40,.95);color:#fff;padding:10px 20px;border-radius:12px;font-size:12px;font-weight:600;z-index:2147483647;pointer-events:none;transition:transform .3s cubic-bezier(.32,0,.67,0);box-shadow:0 8px 30px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.06);backdrop-filter:blur(20px);display:flex;align-items:center;gap:8px}
      .gr-toast.v{transform:translateX(-50%) translateY(0)}

      .gr-hl::-webkit-scrollbar{width:3px}.gr-hl::-webkit-scrollbar-track{background:transparent}.gr-hl::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:3px}
    `;
        document.head.appendChild(css);

        const root = document.createElement("div");
        root.id = ID;
        root.innerHTML = `
      <div class="gr-panel" id="gr-panel">
        <div class="gr-hdr" id="gr-drag">
          <div class="gr-hdr-l">
            <div class="gr-logo">🌍</div>
            <div>
              <div class="gr-ttl">GeoGuessr Revealer</div>
              <div class="gr-ver">v3.2 · Auto Extension</div>
            </div>
          </div>
          <div class="gr-btns">
            <button class="gr-hb" id="gr-min" title="Minimize [G]">─</button>
            <button class="gr-hb" id="gr-cls" title="Close">✕</button>
          </div>
        </div>
        <div class="gr-sbar">
          <div class="gr-sbar-prog" id="gr-prog" style="width:0%"></div>
          <div class="gr-dot s" id="gr-dot"></div>
          <span class="gr-smsg" id="gr-msg">Waiting for game round...</span>
          <span class="gr-mtag" id="gr-mtag" style="display:none"></span>
        </div>
        <div class="gr-body" id="gr-body">
          <div class="gr-map sm" id="gr-mbox">
            <div class="gr-mph" id="gr-mph">🗺️<span>Map preview</span></div>
            <iframe id="gr-mframe" style="display:none" allow="" loading="lazy"></iframe>
            <div class="gr-mo"></div>
            <button class="gr-mzb" id="gr-mzb" title="Expand map" style="display:none">⛶</button>
            <a class="gr-ml" id="gr-mlink" href="#" target="_blank" style="display:none">Open in Maps ↗</a>
          </div>
          <div class="gr-cc">
            <div class="gr-ccl">📍 Coordinates</div>
            <div class="gr-ccv" id="gr-coords">Waiting for round…</div>
            <button class="gr-ccb" id="gr-cpb" title="Copy">📋</button>
          </div>
          <div class="gr-lg" id="gr-locg" style="display:none">
            <div class="gr-li f"><div class="gr-lic" id="gr-flag">🏳️</div><div class="gr-lik">Country</div><div class="gr-liv gc" id="gr-cntry">—</div></div>
            <div class="gr-li"><div class="gr-lic">🏙️</div><div class="gr-lik">City / Town</div><div class="gr-liv" id="gr-city">—</div></div>
            <div class="gr-li"><div class="gr-lic">📍</div><div class="gr-lik">Region</div><div class="gr-liv" id="gr-rgn">—</div></div>
            <div class="gr-li f"><div class="gr-lic">🛣️</div><div class="gr-lik">Address</div><div class="gr-liv" id="gr-road">—</div></div>
          </div>
          <div class="gr-cr" id="gr-camr" style="display:none">
            <div class="gr-chip"><div class="gr-chl">Heading</div><div class="gr-chv" id="gr-hdg">—</div></div>
            <div class="gr-chip"><div class="gr-chl">Pitch</div><div class="gr-chv" id="gr-ptc">—</div></div>
            <div class="gr-chip"><div class="gr-chl">Zoom</div><div class="gr-chv" id="gr-zm">—</div></div>
            <div class="gr-chip"><div class="gr-chl">Pano</div><div class="gr-chv" id="gr-pn" style="font-size:7px">—</div></div>
          </div>
          <div class="gr-acts">
            <button class="gr-ab gr-ap" id="gr-amaps">📍 Maps</button>
            <button class="gr-ab gr-sv" id="gr-asv">🛣️ Street View</button>
            <button class="gr-ab gr-as" id="gr-acopy">📋 Copy</button>
            <button class="gr-ab gr-as" id="gr-aref">🔄</button>
          </div>
          <div class="gr-hist" id="gr-histbox" style="display:none">
            <div class="gr-ht">Round History</div>
            <div class="gr-hl" id="gr-histls"></div>
          </div>
        </div>
        <div class="gr-kbd">
          <span class="gr-k">G</span><span class="gr-kt">toggle</span>
          <span class="gr-k">C</span><span class="gr-kt">copy</span>
          <span class="gr-k">M</span><span class="gr-kt">maps</span>
          <span class="gr-k">R</span><span class="gr-kt">refresh</span>
        </div>
      </div>
      <button class="gr-fab" id="gr-fab" title="Show Panel [G]">🌍</button>
    `;
        document.body.appendChild(root);

        const toastEl = document.createElement("div");
        toastEl.className = "gr-toast"; toastEl.id = "gr-toast";
        document.body.appendChild(toastEl);

        // ── DOM refs ──
        const $ = id => document.getElementById(id);
        const panel = $("gr-panel"), fab = $("gr-fab");
        const dot = $("gr-dot"), msg = $("gr-msg"), mtag = $("gr-mtag");
        const coordsEl = $("gr-coords"), locG = $("gr-locg"), camR = $("gr-camr");
        const mapFrame = $("gr-mframe"), mapPh = $("gr-mph"), mapLk = $("gr-mlink"), mapBox = $("gr-mbox"), mapZb = $("gr-mzb");
        const histBox = $("gr-histbox"), histLs = $("gr-histls");

        // Map expand/collapse toggle
        let mapExpanded = false;
        mapZb.onclick = () => {
            mapExpanded = !mapExpanded;
            mapBox.classList.toggle("sm", !mapExpanded);
            mapBox.classList.toggle("lg", mapExpanded);
            mapZb.textContent = mapExpanded ? "✖" : "⛶";
            mapZb.title = mapExpanded ? "Collapse map" : "Expand map";
        };

        function showToast(m) {
            const t = $("gr-toast"); t.textContent = m; t.classList.add("v");
            setTimeout(() => t.classList.remove("v"), 2200);
        }
        function copyCoords() {
            try {
                if (!S.lat) return showToast("⚠️ No coordinates yet!");
                navigator.clipboard.writeText(`${S.lat.toFixed(6)}, ${S.lng.toFixed(6)}`)
                    .then(() => showToast(`✅ Copied: ${S.lat.toFixed(6)}, ${S.lng.toFixed(6)}`))
                    .catch(() => showToast("⚠️ Clipboard blocked"));
            } catch (e) { showToast("⚠️ Clipboard unavailable"); }
        }
        function copyAll() {
            try {
                if (!S.lat) return showToast("⚠️ No coordinates yet!");
                const lines = [
                    `📍 ${S.lat.toFixed(6)}, ${S.lng.toFixed(6)}`,
                    S.country ? `🏳️ ${S.country}` : null, S.region ? `📍 ${S.region}` : null,
                    S.city ? `🏙️ ${S.city}` : null, S.road ? `🛣️ ${S.road}` : null,
                    `🗺️ https://www.google.com/maps/search/?api=1&query=${S.lat},${S.lng}`,
                ].filter(Boolean).join("\n");
                navigator.clipboard.writeText(lines)
                    .then(() => showToast("✅ All info copied!"))
                    .catch(() => showToast("⚠️ Clipboard blocked"));
            } catch (e) { showToast("⚠️ Clipboard unavailable"); }
        }
        function openMaps() {
            try {
                if (!S.lat) return showToast("⚠️ No coordinates yet!");
                window.open(`https://www.google.com/maps/search/?api=1&query=${S.lat},${S.lng}`, "_blank");
            } catch (e) { }
        }
        function togglePanel() {
            try {
                S.minimized = !S.minimized;
                panel.classList.toggle("gr-hidden", S.minimized);
                fab.classList.toggle("v", S.minimized);
            } catch (e) { }
        }

        function openStreetView() {
            try {
                if (!S.lat) return showToast("⚠️ No coordinates yet!");
                window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${S.lat},${S.lng}`, "_blank");
            } catch (e) { }
        }

        $("gr-cpb").onclick = copyCoords;
        $("gr-amaps").onclick = openMaps;
        $("gr-asv").onclick = openStreetView;
        $("gr-acopy").onclick = copyAll;
        $("gr-aref").onclick = () => {
            try {
                S.lastKey = ""; window.__GH.net = null; window.__GH.pano = null;
                S.found = false; S.geocodeFailed = false;
                S.country = ""; S.city = ""; S.region = ""; S.road = "";
                locG.style.display = "none"; camR.style.display = "none";
                try { mapFrame.removeAttribute("src"); mapFrame.srcdoc = ""; } catch (e) { }
                mapFrame.style.display = "none";
                mapPh.style.display = "flex"; mapLk.style.display = "none"; mapZb.style.display = "none";
                mapBox.classList.add("sm"); mapBox.classList.remove("lg"); mapExpanded = false; mapZb.textContent = "⛶";
                coordsEl.textContent = "Refreshing…"; dot.className = "gr-dot s";
                msg.textContent = "Re-scanning…"; mtag.style.display = "none";
                $("gr-prog").style.width = "0%";
                showToast("🔄 Refreshed");
            } catch (e) { }
        };
        $("gr-min").onclick = togglePanel;
        $("gr-cls").onclick = () => { try { clearInterval(loop); root.remove(); toastEl.remove(); css.remove(); document.removeEventListener("keydown", onKey); } catch (e) { } };
        fab.onclick = togglePanel;

        function onKey(e) {
            try {
                if (["INPUT", "TEXTAREA"].includes(e.target.tagName) || e.target.isContentEditable) return;
                switch (e.key.toLowerCase()) {
                    case "g": togglePanel(); break;
                    case "c": copyCoords(); break;
                    case "m": openMaps(); break;
                    case "r": $("gr-aref").click(); break;
                }
            } catch (err) { }
        }
        document.addEventListener("keydown", onKey);

        // Drag
        let dr = { a: false, x: 0, y: 0 };
        $("gr-drag").addEventListener("mousedown", e => { dr.a = true; const r = root.getBoundingClientRect(); dr.x = e.clientX - r.left; dr.y = e.clientY - r.top; e.preventDefault(); });
        document.addEventListener("mousemove", e => { if (!dr.a) return; root.style.left = (e.clientX - dr.x) + "px"; root.style.top = (e.clientY - dr.y) + "px"; root.style.right = "auto"; });
        document.addEventListener("mouseup", () => { dr.a = false; });

        function updateLocationUI() {
            try {
                const cntryEl = $("gr-cntry"), cityEl = $("gr-city"), rgnEl = $("gr-rgn"), roadEl = $("gr-road"), flagEl = $("gr-flag");
                if (!cntryEl) return;
                if (locG) locG.style.display = "grid";
                if (S.country) {
                    if (flagEl) flagEl.textContent = S.geocodeFailed ? "❓" : ccToFlag(S.countryCode);
                    if (cntryEl) {
                        cntryEl.textContent = S.country;
                        cntryEl.classList.remove("loading"); cntryEl.classList.add("gc");
                    }
                    if (cityEl) { cityEl.textContent = S.city || "—"; cityEl.classList.remove("loading"); }
                    if (rgnEl) { rgnEl.textContent = S.region || "—"; rgnEl.classList.remove("loading"); }
                    if (roadEl) { roadEl.textContent = S.road || "—"; roadEl.classList.remove("loading"); }
                }
            } catch (e) { }
        }
        // Expose for geocode callback
        window.__grUpdateLocUI = updateLocationUI;

        function updateHistory() {
            try {
                if (!S.roundHistory.length) { if (histBox) histBox.style.display = "none"; return; }
                if (histBox) histBox.style.display = "block";
                if (histLs) histLs.innerHTML = S.roundHistory.slice().reverse().map(r => `
            <div class="gr-hi"><div class="gr-hn">${r.num}</div><div class="gr-hf">${r.flag}</div>
            <div class="gr-hna">${r.country || (r.failed ? "Unknown location" : "Locating…")}</div>
            <div class="gr-hco">${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}</div></div>
          `).join("");
            } catch (e) { }
        }

        function mainLoop() {
            try {
                // Bail if panel was removed
                if (!document.getElementById(ID)) return;

                // ── Check for round changes and clear stale data ──
                detectRoundChange();

                const prog = $("gr-prog");
                if (!prog) return; // guard: panel DOM gone

                const result = findCoordinates();
                if (result) {
                    S.lat = result.lat; S.lng = result.lng;
                    S.found = true; S.detectionMethod = result.method; S.confidence = result.confidence;

                    if (coordsEl) coordsEl.textContent = `${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`;
                    if (dot) dot.className = "gr-dot l";
                    if (msg) msg.textContent = `Location locked · ${result.confidence}%`;
                    if (mtag) { mtag.textContent = result.method; mtag.style.display = "inline"; }
                    prog.style.width = `${result.confidence}%`;

                    if (S.heading != null || S.panoId) {
                        if (camR) camR.style.display = "flex";
                        const hdg = $("gr-hdg"), ptc = $("gr-ptc"), zm = $("gr-zm"), pn = $("gr-pn");
                        if (hdg) hdg.textContent = S.heading != null ? `${S.heading.toFixed(1)}°` : "—";
                        if (ptc) ptc.textContent = S.pitch != null ? `${S.pitch.toFixed(1)}°` : "—";
                        if (zm) zm.textContent = S.zoom != null ? S.zoom.toFixed(1) : "—";
                        if (pn) pn.textContent = S.panoId || "—";
                    }

                    const key = `${result.lat.toFixed(5)},${result.lng.toFixed(5)}`;
                    if (key !== S.lastKey) {
                        S.lastKey = key; S.roundNum++;
                        const thisRound = S.roundNum; // capture for async closure
                        S.roundHistory.push({ num: thisRound, lat: result.lat, lng: result.lng, country: "", flag: "🔄", failed: false });
                        updateHistory();

                        // Show loading placeholders directly on the DOM
                        S.geocoding = true;
                        locG.style.display = "grid";
                        const _f = $("gr-flag"), _c = $("gr-cntry"), _ci = $("gr-city"), _r = $("gr-rgn"), _rd = $("gr-road");
                        if (_f) _f.textContent = "🔄";
                        if (_c) { _c.textContent = "Locating…"; _c.classList.add("loading"); _c.classList.remove("gc"); }
                        if (_ci) { _ci.textContent = "…"; _ci.classList.add("loading"); }
                        if (_r) { _r.textContent = "…"; _r.classList.add("loading"); }
                        if (_rd) { _rd.textContent = "…"; _rd.classList.add("loading"); }

                        // Interactive map — OpenStreetMap embed (zoomable, pannable)
                        try {
                            const d = 0.15;
                            const bbox = `${(result.lng - d).toFixed(4)},${(result.lat - d).toFixed(4)},${(result.lng + d).toFixed(4)},${(result.lat + d).toFixed(4)}`;
                            mapFrame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${result.lat},${result.lng}`;
                            mapFrame.onerror = () => {
                                mapFrame.style.display = "none"; mapPh.style.display = "flex";
                            };
                            mapFrame.style.display = "block"; mapPh.style.display = "none";
                            mapZb.style.display = "flex";
                        } catch (mapErr) {
                            mapFrame.style.display = "none"; mapPh.style.display = "flex";
                        }
                        mapLk.href = `https://www.google.com/maps/search/?api=1&query=${result.lat},${result.lng}`;
                        mapLk.style.display = "block";

                        // Geocode — simple: call and update history when done
                        clearTimeout(geoTimer);
                        geoTimer = setTimeout(async () => {
                            try {
                                await geocode(result.lat, result.lng);
                            } catch (e) { /* geocode handles errors internally */ }
                            // Update history entry after geocode completes
                            const entry = S.roundHistory.find(h => h.num === thisRound);
                            if (entry) {
                                entry.country = S.country || (S.geocodeFailed ? "Unknown" : "");
                                entry.flag = S.geocodeFailed ? "❓" : ccToFlag(S.countryCode);
                                entry.failed = S.geocodeFailed;
                                updateHistory();
                            }
                        }, 600);
                    }
                } else if (!S.found) {
                    // Reset UI to scanning state
                    if (dot) dot.className = "gr-dot s";
                    if (msg) msg.textContent = "Scanning for new round…";
                    if (mtag) mtag.style.display = "none";
                    if (coordsEl) coordsEl.textContent = "Scanning…";
                    if (locG) locG.style.display = "none";
                    if (camR) camR.style.display = "none";
                    prog.style.width = "0%";
                    if (mapFrame) mapFrame.style.display = "none";
                    if (mapPh) mapPh.style.display = "flex";
                    if (mapLk) mapLk.style.display = "none";
                    if (mapZb) mapZb.style.display = "none";
                }
            } catch (e) {
                // Silently ignore to prevent console spam; only warn on debug builds
                if (typeof console !== "undefined") console.warn("🌍 GeoGuessr Revealer: mainLoop error:", e);
            }
        }

        // Faster polling (300ms) for quicker round pickup
        const loop = setInterval(mainLoop, 300);
        mainLoop();

        console.log(
            "%c🌍 GeoGuessr Revealer v3.2 — Extension Active!%c\n8 detection methods · Auto-overlay · Press G to toggle",
            "color:#a855f7;font-size:16px;font-weight:bold;", "color:#94a3b8;font-size:11px;"
        );
    }
})();
