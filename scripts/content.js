// ===================== content.js ===================== //
(function () {
    console.clear();
    console.log("🚀 [Content Script] Loaded successfully at", new Date().toISOString());
    console.log("🌐 Current URL:", window.location.href);

    // -------------------- Helper: Timestamped Logger --------------------
    function logInfo(label, ...args) {
        console.log(`🟢 [${new Date().toISOString()}] [INFO] ${label}`, ...args);
    }

    function logWarn(label, ...args) {
        console.warn(`🟠 [${new Date().toISOString()}] [WARN] ${label}`, ...args);
    }

    function logError(label, error, context = {}) {
    let message;
    try {
        message = error?.message || JSON.stringify(error, null, 2) || String(error);
    } catch {
        message = String(error);
    }

    console.error(`🔴 [${new Date().toISOString()}] [ERROR] ${label}`, {
        message,
        stack: error?.stack || "No stack trace",
        context,
    });
}

    // -------------------- Get Video ID --------------------
    function getVideoId() {
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.has("v")) {
                const id = params.get("v");
                logInfo("Extracted video ID from query parameter:", id);
                return id;
            }

            const regex = /(?:youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/;
            const match = window.location.href.match(regex);
            const id = match ? match[1] : null;

            if (id) logInfo("Extracted video ID from embed or short URL:", id);
            else logWarn("No video ID found in current URL pattern:", window.location.href);

            return id;
        } catch (err) {
            logError("Error extracting video ID", err);
            return null;
        }
    }

    // Track last seen videoId and URL
    let lastVideoId = null;
    let lastUrl = location.href;

    // -------------------- Safe sendMessage --------------------
    async function safeSendMessage(message) {
        logInfo("Preparing to send message to background:", message);
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (resp) => {
                    if (chrome.runtime.lastError) {
                        logWarn("Message failed to send (runtime error):", chrome.runtime.lastError.message);
                        resolve(null);
                    } else {
                        logInfo("Background response received:", resp);
                        resolve(resp);
                    }
                });
            } catch (err) {
                logError("Unexpected exception while sending message", err);
                resolve(null);
            }
        });
    }

    // -------------------- Notify Background --------------------
    async function notifyBackground(videoId) {
        try {
            if (!videoId) {
                logWarn("notifyBackground called with invalid videoId:", videoId);
                return;
            }
            if (videoId === lastVideoId) {
                logInfo("Video ID unchanged since last check, skipping:", videoId);
                return;
            }

            logInfo("🎬 New YouTube video detected!", { videoId, url: window.location.href });
            lastVideoId = videoId;

            // 1️⃣ Send detected videoId for tracking
            const idResp = await safeSendMessage({ action: "videoIdDetected", videoId });
            logInfo("videoIdDetected message sent, response:", idResp);

            // 2️⃣ Trigger comment fetching
            const fetchResp = await safeSendMessage({ action: "fetchComments", videoId });
            logInfo("fetchComments message sent, response:", fetchResp);

            if (fetchResp?.error) {
                logError("Background reported error while fetching comments", fetchResp.error);
            } else {
                logInfo("💬 Comment fetching triggered successfully for video ID:", videoId);
            }
        } catch (err) {
            logError("notifyBackground encountered an unexpected error", err);
        }
    }

    // -------------------- Initial Detection --------------------
    try {
        const initialVideoId = getVideoId();
        if (initialVideoId) {
            logInfo("Initial video detected on page load:", initialVideoId);
            notifyBackground(initialVideoId);
        } else {
            logWarn("No initial video detected at script load.");
        }
    } catch (err) {
        logError("Error during initial detection", err);
    }

    // -------------------- SPA Navigation Detection --------------------
    try {
        logInfo("Setting up MutationObserver for SPA navigation monitoring...");

        new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                logInfo("🔄 URL changed detected!", { from: lastUrl, to: currentUrl });
                lastUrl = currentUrl;
                const newVideoId = getVideoId();
                if (newVideoId) {
                    logInfo("New video ID extracted after SPA change:", newVideoId);
                    notifyBackground(newVideoId);
                } else {
                    logWarn("URL changed, but no valid video ID detected:", currentUrl);
                }
            }
        }).observe(document, { subtree: true, childList: true });

        logInfo("✅ MutationObserver initialized successfully.");
    } catch (err) {
        logError("Error initializing MutationObserver", err);
    }

    // -------------------- Global Error Tracking --------------------
    window.addEventListener("error", (e) => {
        logError("Global runtime error caught", e.error || e.message);
    });

    window.addEventListener("unhandledrejection", (e) => {
        logError("Unhandled Promise rejection", e.reason);
    });
})();
