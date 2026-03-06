// ── Injector: runs at document_start ──
// Injects hack.js as a page-level script so it has full access
// to the page's JS context (google.maps, etc.)

(function () {
    "use strict";

    function inject() {
        try {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("hack.js");
            script.onerror = function () {
                // Retry once after a short delay if initial load fails
                console.warn("🌍 GeoGuessr Revealer: injection failed, retrying...");
                setTimeout(inject, 500);
            };
            script.onload = function () {
                this.remove(); // Clean up after injection
            };

            // Inject as early as possible — use whatever parent is available
            const parent = document.head || document.documentElement || document.body;
            if (parent) {
                parent.appendChild(script);
            } else {
                // If nothing is available yet, wait for DOMContentLoaded
                document.addEventListener("DOMContentLoaded", () => {
                    (document.head || document.documentElement || document.body).appendChild(script);
                }, { once: true });
            }
        } catch (e) {
            console.error("🌍 GeoGuessr Revealer: injection error:", e);
            // Last resort: try again after DOM is ready
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", inject, { once: true });
            }
        }
    }

    inject();
})();
