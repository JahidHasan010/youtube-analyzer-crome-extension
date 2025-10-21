// ===================== background.js (HARDENED) ===================== //
console.clear();
console.log("🚀 [Background Script] Loaded successfully at", new Date().toISOString());

// -------------------- Small utilities --------------------
function safeStringify(obj, maxLen = 1000) {
    // Stringify without throwing on circular references, limit output length
    const seen = new WeakSet();
    try {
        const str = JSON.stringify(
            obj,
            (k, v) => {
                if (typeof v === "object" && v !== null) {
                    if (seen.has(v)) return "[Circular]";
                    seen.add(v);
                }
                // Avoid extremely large nested values
                if (typeof v === "string" && v.length > maxLen) return v.slice(0, maxLen) + "...(truncated)";
                return v;
            },
            2
        );
        return str;
    } catch (err) {
        try {
            return String(obj);
        } catch {
            return "[Unstringifiable object]";
        }
    }
}

function safeAccessStack(err) {
    try {
        return err?.stack || "No stack available";
    } catch {
        return "No stack available";
    }
}

// -------------------- Logging --------------------
function logInfo(label, ...args) {
    try {
        console.log(`🟢 [${new Date().toISOString()}] [INFO] ${label}`, ...args);
    } catch {}
}

function logWarn(label, ...args) {
    try {
        console.warn(`🟠 [${new Date().toISOString()}] [WARN] ${label}`, ...args);
    } catch {}
}

function logError(label, error, context = {}) {
    // Defensive: never throw.
    try {
        let message = "";
        try {
            if (error && typeof error === "object" && "message" in error && error.message) {
                message = String(error.message);
            } else {
                message = safeStringify(error);
            }
        } catch {
            message = String(error);
        }

        const stack = safeAccessStack(error);

        // Trim context for logging
        const ctxStr = safeStringify(context, 500);

        console.error(`🔴 [${new Date().toISOString()}] [ERROR] ${label}`, {
            message,
            stack,
            context: ctxStr,
        });
    } catch (err) {
        // Last-resort: log minimal info to avoid throwing
        try {
            console.error("🔴 [logError] Failed to log error safely:", err, { originalLabel: label });
        } catch {}
    }
}

// -------------------- Safe chrome.storage wrappers --------------------
function storageGet(key) {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.get(key, (items) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    // reject when chrome reports error
                    return reject(err);
                }
                resolve(items?.[key] ?? null);
            });
        } catch (err) {
            reject(err);
        }
    });
}

function storageSet(obj) {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.set(obj, () => {
                const err = chrome.runtime.lastError;
                if (err) return reject(err);
                resolve();
            });
        } catch (err) {
            reject(err);
        }
    });
}

// -------------------- On installation --------------------
chrome.runtime.onInstalled.addListener(() => {
    (async () => {
        try {
            // IMPORTANT: Replace with your real key; for safety example still shows placeholder
            // const initial = { ytApiKey: "" };
            const initial = { ytApiKey: "" };
            await storageSet(initial);
            logInfo("✅ YouTube API key saved to storage.");
        } catch (err) {
            logError("Failed to save initial API key in onInstalled", err);
        }
    })();
});

// -------------------- Enhanced Fetch with Retry Logic --------------------
async function fetchWithRetry(url, retries = 3, delay = 1000) {
    logInfo(`Starting fetchWithRetry for URL: ${url}, Retries: ${retries}`);
    for (let i = 0; i < retries; i++) {
        try {
            const resp = await fetch(url);
            const text = await resp.text().catch(() => "");

            if (!resp.ok) {
                const snippet = (text || "").slice(0, 300);
                logWarn(`⚠️ HTTP error on attempt ${i + 1}`, {
                    status: resp.status,
                    body: snippet,
                });

                // Attempt to parse API error if present
                try {
                    const apiError = JSON.parse(text || "{}");
                    if (apiError?.error?.message) {
                        throw new Error(`YouTube API error: ${apiError.error.message}`);
                    }
                } catch (jsonErr) {
                    // If parsing fails, raise an HTTP error with snippet
                    throw new Error(`HTTP ${resp.status}: ${snippet || resp.statusText}`);
                }
            }

            // parse JSON safely
            try {
                const json = JSON.parse(text || "{}");
                logInfo(`✅ Fetch successful on attempt ${i + 1}`);
                return json;
            } catch (parseErr) {
                throw new Error("Failed to parse JSON response");
            }
        } catch (err) {
            logWarn(`❌ Attempt ${i + 1} failed`, { message: String(err?.message || err), stack: safeAccessStack(err) });
            if (i < retries - 1) {
                logInfo(`⏳ Retrying after ${delay}ms...`);
                // exponential backoff but bounded
                await new Promise((r) => setTimeout(r, delay * (1 + i)));
            } else {
                logError("❌ fetchWithRetry exhausted all attempts", err, { url });
                // Bubble an Error instance (not arbitrary object)
                throw new Error(`Failed fetching URL after ${retries} attempts: ${err?.message || String(err)}`);
            }
        }
    }
    // Should not reach here
    throw new Error("fetchWithRetry reached unexpected end");
}

// -------------------- YouTube Comments Fetching --------------------
async function fetchReplies(parentId, apiKey) {
    const replies = [];
    let pageToken = "";
    const baseUrl = "https://www.googleapis.com/youtube/v3/comments";

    logInfo("Fetching replies for comment ID:", parentId);

    try {
        do {
            const url = new URL(baseUrl);
            url.searchParams.set("part", "snippet");
            url.searchParams.set("parentId", parentId);
            url.searchParams.set("key", apiKey);
            url.searchParams.set("maxResults", "100");
            if (pageToken) url.searchParams.set("pageToken", pageToken);

            const data = await fetchWithRetry(url.toString());

            (data.items || []).forEach((item) => {
                const snippet = item.snippet;
                if (!snippet) return;

                const emojis = Array.from(
                    (snippet.textDisplay || "").matchAll(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu),
                    (m) => m[0]
                );

                replies.push({
                    id: item.id,
                    text: snippet.textDisplay || "",
                    timestamp: new Date(snippet.publishedAt).getTime() / 1000,
                    sentiment: null,
                    sentimentStrength: null,
                    topic: "General",
                    emojis,
                });
            });

            pageToken = data.nextPageToken || "";
        } while (pageToken);

        logInfo(`✅ Total replies fetched for ${parentId}: ${replies.length}`);
    } catch (err) {
        logError("Error fetching replies", err, { parentId });
        // Return partial replies rather than rethrowing to allow caller to continue
    }

    return replies;
}

async function fetchAllComments(videoId, apiKey) {
    const comments = [];
    let pageToken = "";
    const baseUrl = "https://www.googleapis.com/youtube/v3/commentThreads";

    logInfo("🎬 Starting fetchAllComments", { videoId });

    try {
        do {
            const url = new URL(baseUrl);
            url.searchParams.set("part", "snippet");
            url.searchParams.set("videoId", videoId);
            url.searchParams.set("key", apiKey);
            url.searchParams.set("maxResults", "100");
            if (pageToken) url.searchParams.set("pageToken", pageToken);

            logInfo("Fetching comments batch with pageToken:", pageToken || "none");
            const data = await fetchWithRetry(url.toString());

            for (const item of data.items || []) {
                const snippet = item?.snippet?.topLevelComment?.snippet;
                if (snippet) {
                    try {
                        comments.push({
                            id: item.snippet.topLevelComment.id,
                            text: snippet.textDisplay,
                            timestamp: new Date(snippet.publishedAt).getTime() / 1000,
                            sentiment: null,
                            sentimentStrength: null,
                            topic: "General",
                            emojis: Array.from(
                                (snippet.textDisplay || "").matchAll(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu),
                                (m) => m[0]
                            ),
                        });
                    } catch (innerErr) {
                        logWarn("Skipping a comment due to parse error", { id: item?.snippet?.topLevelComment?.id, err: innerErr });
                    }
                }

                if (item.snippet && item.snippet.totalReplyCount > 0) {
                    logInfo(`Fetching ${item.snippet.totalReplyCount} replies for parent ID:`, item.snippet.topLevelComment.id);
                    const replies = await fetchReplies(item.snippet.topLevelComment.id, apiKey).catch((e) => {
                        logWarn("fetchReplies failed but continuing", e);
                        return [];
                    });
                    comments.push(...replies);
                }
            }

            pageToken = data.nextPageToken || "";

            chrome.runtime.sendMessage({
                action: "progressUpdate",
                processedComments: comments.length,
            });

            logInfo(`Fetched ${comments.length} comments so far...`);
            await new Promise((r) => setTimeout(r, 200));
        } while (pageToken);

        logInfo(`✅ Total comments fetched: ${comments.length}`);
        return comments;
    } catch (err) {
        logError("Error fetching all comments", err, { videoId });
        // Rethrow a normalized Error so callers can handle it clearly
        throw new Error(`Failed to fetch comments for video ${videoId}: ${err?.message || String(err)}`);
    }
}

// -------------------- Send All Comments at Once --------------------
async function sendAllComments(comments) {
    logInfo("Sending all comments to /analyze API...", { count: comments.length });

    try {
        const resp = await fetch("http://127.0.0.1:8000/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comments }),
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new Error(`Analysis API error: ${resp.status} ${text}`);
        }

        const data = await resp.json().catch(() => {
            throw new Error("Invalid JSON from analysis API");
        });

        await storageSet({
            analysisResults: data,
            lastFetchedAt: Date.now(),
        }).catch((e) => logWarn("Failed to save analysis to storage", e));

        chrome.runtime.sendMessage({
            action: "updateUI",
            analysisResults: data,
        });

        logInfo(`✅ All comments successfully sent and analyzed. Total: ${comments.length}`);
    } catch (err) {
        logError("Error sending comments to /analyze API", err, { totalComments: comments.length });
        // notify UI
        try {
            chrome.runtime.sendMessage({ action: "updateUI", error: String(err?.message || err) });
        } catch (e) {
            logWarn("Failed to send updateUI message after analysis error", e);
        }
    }
}

// -------------------- Message Listener --------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    logInfo("Received message from content script:", request);

    if (request.action === "fetchComments") {
        (async () => {
            try {
                let videoId = request.videoId;
                logInfo("Starting fetchComments process for video ID:", videoId);

                if (!videoId) {
                    const tabs = await new Promise((resolve) =>
                        chrome.tabs.query({ active: true, currentWindow: true }, resolve)
                    );
                    const tab = tabs && tabs[0];
                    if (!tab || !tab.url) {
                        return sendResponse({ error: "Could not determine active tab or URL" });
                    }
                    try {
                        const url = new URL(tab.url);
                        videoId = url.searchParams.get("v");
                        logInfo("Extracted video ID from tab:", videoId);
                    } catch (err) {
                        logWarn("Failed to parse tab URL", err);
                    }
                    if (!videoId) {
                        return sendResponse({ error: "Video ID not provided." });
                    }
                }

                const apiKey = await storageGet("ytApiKey").catch((e) => {
                    logWarn("storageGet failed for ytApiKey", e);
                    return null;
                });

                if (!apiKey) {
                    sendResponse({ error: "YouTube API key not set." });
                    return;
                }

                const allComments = await fetchAllComments(videoId, apiKey);
                await sendAllComments(allComments);

                logInfo("✅ Finished full comment pipeline for video:", videoId);
                sendResponse({ success: true, totalComments: allComments.length });
            } catch (err) {
                logError("Unhandled error during fetchComments pipeline", err, request);
                // Ensure we always send a response
                try {
                    sendResponse({ error: err?.message || String(err) });
                } catch (e) {
                    logWarn("Failed to send response in catch", e);
                }
            }
        })().catch((err) => {
            // Defensive: if IIFE fails to start, handle it
            logError("IIFE for fetchComments failed to start", err);
            try {
                sendResponse({ error: String(err) });
            } catch {}
        });

        return true; // Keep channel open for async response
    }
});

// -------------------- Global Error Tracking (Hardened) --------------------
self.addEventListener("error", (e) => {
    try {
        logError("Global runtime error caught", e.error || e.message || e);
    } catch {}
});

self.addEventListener("unhandledrejection", (e) => {
    // Defensive: ensure logging here cannot throw
    try {
        logError("Unhandled Promise rejection", e.reason, { promise: String(e?.promise || "unknown") });
        // Optionally prevent default (commented out); use with care.
        // e.preventDefault();
    } catch (err) {
        try {
            console.error("🛑 unhandledrejection handler failed:", err);
        } catch {}
    }
});
