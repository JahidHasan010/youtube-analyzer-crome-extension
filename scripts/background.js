

// 14/10/25 dudpur a


// ===================== background.js ===================== //
console.clear();
console.log("🚀 [Background Script] Loaded successfully at", new Date().toISOString());

// -------------------- Helper Logging Functions --------------------
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

// -------------------- On Installation --------------------
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set(
        {
            // ✅ IMPORTANT: Replace this with your valid YouTube Data API v3 key (must start with "AIza")
            
            ytApiKey: "here add your real actual api key",
        },
        () => logInfo("✅ YouTube API key saved to storage.")
    );
});

// -------------------- Helper Functions --------------------

// Get API key from storage
async function getApiKeyFromStorage() {
    logInfo("Fetching API key from chrome.storage.local...");
    try {
        const apiKey = await new Promise((resolve) => {
            chrome.storage.local.get("ytApiKey", (items) => resolve(items.ytApiKey || null));
        });
        if (apiKey) logInfo("API key successfully retrieved.");
        else logWarn("No API key found in storage!");
        return apiKey;
    } catch (err) {
        logError("Failed to get API key from storage", err);
        return null;
    }
}

// Store data in local storage
async function setLocalStorage(obj) {
    logInfo("Saving data to local storage...", obj);
    try {
        await new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()));
        logInfo("✅ Data successfully saved to local storage.");
    } catch (err) {
        logError("Failed to set local storage", err, { data: obj });
    }
}

// -------------------- Enhanced Fetch with Retry Logic --------------------
async function fetchWithRetry(url, retries = 3, delay = 1000) {
    logInfo(`Starting fetchWithRetry for URL: ${url}, Retries: ${retries}`);

    for (let i = 0; i < retries; i++) {
        try {
            const resp = await fetch(url);
            const text = await resp.text(); // Always capture the raw response text

            if (!resp.ok) {
                // Log the first 300 chars of the body to identify YouTube errors (quota, key, etc.)
                const snippet = text.slice(0, 300);
                logWarn(`⚠️ HTTP error on attempt ${i + 1}`, {
                    status: resp.status,
                    body: snippet,
                });

                // Decode YouTube error if present
                let apiError = null;
                try {
                    apiError = JSON.parse(text);
                    if (apiError?.error?.message) {
                        throw new Error(`YouTube API error: ${apiError.error.message}`);
                    }
                } catch (jsonErr) {
                    throw new Error(`HTTP ${resp.status}: ${snippet}`);
                }
            }

            const json = JSON.parse(text);
            logInfo(`✅ Fetch successful on attempt ${i + 1}`);
            return json;
        } catch (err) {
            logWarn(`❌ Attempt ${i + 1} failed`, { message: err.message, stack: err.stack });

            if (i < retries - 1) {
                logInfo(`⏳ Retrying after ${delay}ms...`);
                await new Promise((r) => setTimeout(r, delay));
            } else {
                logError("❌ FetchWithRetry failed all attempts", err, { url });
            }
        }
    }

    throw new Error(`Failed fetching URL after ${retries} attempts`);
}

// -------------------- YouTube Comments Fetching --------------------
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
                    comments.push({
                        id: item.snippet.topLevelComment.id,
                        text: snippet.textDisplay,
                        timestamp: new Date(snippet.publishedAt).getTime() / 1000,
                        sentiment: null,
                        sentimentStrength: null,
                        topic: "General",
                        emojis: Array.from(
                            snippet.textDisplay.matchAll(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu),
                            (m) => m[0]
                        ),
                    });
                }

                // Fetch replies
                if (item.snippet.totalReplyCount > 0) {
                    logInfo(`Fetching ${item.snippet.totalReplyCount} replies for parent ID:`, item.snippet.topLevelComment.id);
                    const replies = await fetchReplies(item.snippet.topLevelComment.id, apiKey);
                    comments.push(...replies);
                }
            }

            pageToken = data.nextPageToken || "";

            chrome.runtime.sendMessage({
                action: "progressUpdate",
                processedComments: comments.length,
            });

            logInfo(`Fetched ${comments.length} comments so far...`);
            await new Promise((r) => setTimeout(r, 200)); // small delay
        } while (pageToken);

        logInfo(`✅ Total comments fetched: ${comments.length}`);
        return comments;
    } catch (err) {
        logError("Error fetching all comments", err, { videoId });
        throw err;
    }
}

// -------------------- Fetch replies --------------------
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
                    snippet.textDisplay.matchAll(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu),
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
    }

    return replies;
}

// -------------------- Send All Comments at Once --------------------
async function sendAllComments(comments) {
    logInfo("Sending all comments to /analyze API...", { count: comments.length });

    try {
        // const resp = await fetch("http://127.0.0.1:8000/analyze", {
        const resp = await fetch("https://youtube-analyzer-backend-03m2.onrender.com/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comments }),
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new Error(`Analysis API error: ${resp.status} ${text}`);
        }

        const data = await resp.json();

        await setLocalStorage({
            analysisResults: data,
            lastFetchedAt: Date.now(),
        });

        chrome.runtime.sendMessage({
            action: "updateUI",
            analysisResults: data,
        });

        logInfo(`✅ All comments successfully sent and analyzed. Total: ${comments.length}`);
    } catch (err) {
        logError("Error sending comments to /analyze API", err, { totalComments: comments.length });
        chrome.runtime.sendMessage({ action: "updateUI", error: err.message });
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

                // Get videoId if not provided
                if (!videoId) {
                    const tabs = await new Promise((resolve) =>
                        chrome.tabs.query({ active: true, currentWindow: true }, resolve)
                    );
                    const tab = tabs[0];
                    const url = new URL(tab.url);
                    videoId = url.searchParams.get("v");
                    logInfo("Extracted video ID from tab:", videoId);
                    if (!videoId) {
                        sendResponse({ error: "Video ID not provided." });
                        return;
                    }
                }

                // Get API key
                const apiKey = await getApiKeyFromStorage();
                if (!apiKey) {
                    sendResponse({ error: "YouTube API key not set." });
                    return;
                }

                // Fetch and analyze
                const allComments = await fetchAllComments(videoId, apiKey);
                await sendAllComments(allComments);

                logInfo("✅ Finished full comment pipeline for video:", videoId);
                sendResponse({ success: true, totalComments: allComments.length });
            } catch (err) {
                logError("Unhandled error during fetchComments pipeline", err, request);
                sendResponse({ error: err.message || String(err) });
            }
        })();

        return true; // Keep channel open for async response
    }
});

// -------------------- Global Error Tracking --------------------
self.addEventListener("error", (e) => {
    logError("Global runtime error caught", e.error || e.message);
});

self.addEventListener("unhandledrejection", (e) => {
    logError("Unhandled Promise rejection", e.reason);
});
