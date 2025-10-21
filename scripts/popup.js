// ==================== popup.js (Enhanced with Detailed Logging) ==================== //
// Global variable for the chart instance (assuming it's defined elsewhere)


// --- GLOBAL STATE ---
let commentsData = [];
let selectedSentiment = null;
let timelineChart, overallSentimentChart, topicSentimentChart, sentimentStrengthChart;

// Stopwords for word cloud
const stopWords = new Set([
  'the','a','an','and','or','but','is','are','was','were','to','in','of','for','on',
  'with','from','as','at','it','this','that','so','what','you','i','me','my','he','she',
  'we','they','our','their','your','be','been','about','just','can','cant','would','will',
  'go','up','down','out','off','too','very','here','there','who','how','when','why','like',
  'video','content','quality'
]);

// ================== LOGGING SYSTEM ==================
function timestamp() {
  return new Date().toLocaleTimeString();
}

function logInfo(msg, ...args) {
  console.log(`ℹ️ [INFO - ${timestamp()}] ${msg}`, ...args);
}

function logDebug(msg, ...args) {
  console.debug(`🐞 [DEBUG - ${timestamp()}] ${msg}`, ...args);
}

function logError(msg, err) {
  console.error(`❌ [ERROR - ${timestamp()}] ${msg}`, err);
}

// Global error catcher
window.onerror = function (msg, src, line, col, err) {
  logError(`Global Error: ${msg} at ${src}:${line}:${col}`, err);
};
window.addEventListener("unhandledrejection", (e) => {
  logError("Unhandled Promise Rejection:", e.reason);
});

// --- UTILITY FUNCTIONS ---
const safeGetContext = (id) => document.getElementById(id)?.getContext('2d');

function toDateFromAny(ts) {
  try {
    if (!ts) return null;
    if (typeof ts === 'number') {
      const val = ts < 1e12 ? ts * 1000 : ts;
      return new Date(val);
    }
    const n = Number(ts);
    if (!Number.isNaN(n)) {
      const val = n < 1e12 ? n * 1000 : n;
      return new Date(val);
    }
    return new Date(ts);
  } catch (err) {
    logError("Failed to convert timestamp:", err);
    return null;
  }
}





const formatTime = (ts) => {
  const date = toDateFromAny(ts);
  if (!date || isNaN(date)) return "00:00";
  const s = Math.floor(date.getTime() / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};




// --- INITIAL LOAD ---
window.onload = () => {
  logInfo("Popup loaded. Sending request to fetch comments...");
  chrome.runtime.sendMessage({ action: "fetchComments" }, (resp) => {
    if (resp?.error) logError("Fetch error from background:", resp.error);
    else logInfo("Initial fetchComments request sent successfully.");
  });
};

// --- REAL-TIME UPDATE LISTENER ---
chrome.runtime.onMessage.addListener((request) => {
  logDebug("Received message from background:", request);
  if (request.action === "updateUI") {
    logInfo("Triggering UI update due to background message...");
    updateCommentsData();
  }
});

// --- MAIN DATA UPDATE ---
const updateCommentsData = () => {
  logInfo("Updating comments data from local storage...");
  chrome.storage.local.get(['analysisResults'], (data) => {
    const predictions = data.analysisResults?.comments || [];
    logDebug("Fetched analysisResults:", predictions);

    if (predictions.length) {
      commentsData = predictions.map(p => ({
        id: p.id,
        text: p.text,
        sentiment: p.sentiment?.toLowerCase() || 'neutral',
        strength: p.sentimentStrength?.toLowerCase() || 'weak',
        topic: p.topic || 'General',
        timestamp: p.timestamp || 0,
        emojis: p.emojis || []
      }));
      logInfo(`Loaded ${commentsData.length} comments into state.`);
      renderDashboard();
    } else {
      logInfo("No comments found in storage.");
    }
  });
};

// --- DATA PROCESSING ---
const getSentimentCounts = () => {
  const result = commentsData.reduce((acc, c) => {
    acc[c.sentiment] = (acc[c.sentiment] || 0) + 1;
    return acc;
  }, { positive: 0, neutral: 0, negative: 0 });
  logDebug("Sentiment counts:", result);
  return result;
};

const processTimelineData = () => {
  try {
    const map = {};
    commentsData.forEach(c => {
      const ts = toDateFromAny(c.timestamp);
      if (!ts) return;
      const sec = Math.floor(ts.getTime() / 1000);
      const bin = Math.floor(sec / 30) * 30;
      if (!map[bin]) map[bin] = { bin, positive: 0, neutral: 0, negative: 0 };
      if (c.sentiment && map[bin][c.sentiment] !== undefined)
        map[bin][c.sentiment] += 1;
    });
    const result = Object.values(map).sort((a, b) => a.bin - b.bin);
    logDebug("Processed timeline data:", result);
    return result;
  } catch (err) {
    logError("Error processing timeline data:", err);
    return [];
  }
};





const processTopicSentimentData = () => {
  const topics = {};
  commentsData.forEach(c => {
    if (!topics[c.topic]) topics[c.topic] = { topic: c.topic, positive: 0, neutral: 0, negative: 0 };
    topics[c.topic][c.sentiment]++;
  });
  const result = Object.values(topics);
  logDebug("Topic sentiment data:", result);
  return result;
};

const processEmojiData = () => {
  const map = {};
  commentsData.forEach(c => c.emojis.forEach(e => map[e] = (map[e] || 0) + 1));
  const result = Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 6);
  logDebug("Emoji data:", result);
  return result;
};

const processWordCloudData = () => {
  try {
    const counts = {};
    const allText = commentsData.map(c => c.text.toLowerCase().replace(/[.,!?'"()/]/g, '')).join(' ');
    allText.split(/\s+/).forEach(w => {
      if (w.length > 2 && !stopWords.has(w)) counts[w] = (counts[w] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
    const max = sorted.length ? sorted[0][1] : 1;
    const min = sorted.length ? sorted[sorted.length - 1][1] : 1;
    const scale = count => max === min ? 2 : 1 + (count - min) / (max - min) * 4;
    const result = sorted.slice(0, 30).map(([word, count]) => ({
      word,
      size: scale(count),
      rotation: Math.random() > 0.7 ? -90 : 0
    }));
    logDebug("Word cloud data:", result);
    return result;
  } catch (err) {
    logError("Error processing word cloud data:", err);
    return [];
  }
};



// Global safety catchers
window.onerror = function (msg, src, line, col, err) {
  logError(`Global Error: ${msg} at ${src}:${line}:${col}`, err);
};
window.addEventListener("unhandledrejection", (e) => {
  logError("Unhandled Promise Rejection:", e.reason);
});

// ==================== SENTIMENT CARDS ==================== //
const renderSentimentCards = () => {
  logInfo("Starting renderSentimentCards()...");

  try {
    const container = document.getElementById('sentiment-overview');
    if (!container) {
      logError("Container #sentiment-overview not found. Skipping rendering.");
      return;
    }

    const counts = getSentimentCounts();
    logDebug("Sentiment counts fetched:", counts);

    const sentiments = [
      { type: 'positive', icon: '👍', color: 'positive' },
      { type: 'neutral', icon: '😐', color: 'neutral' },
      { type: 'negative', icon: '👎', color: 'negative' }
    ];

    container.querySelectorAll('.sentiment-card').forEach(c => c.remove());
    logInfo("Cleared previous sentiment cards.");

    sentiments.forEach(s => {
      const card = document.createElement('button');
      card.className = `sentiment-card ${s.color}` + (selectedSentiment === s.type ? ' selected' : '');
      card.innerHTML = `<span class="icon">${s.icon}</span><h3>${s.type}</h3><p>${counts[s.type]}</p>`;

      card.onclick = () => {
        selectedSentiment = selectedSentiment === s.type ? null : s.type;
        logInfo(`Sentiment card clicked. Selected sentiment: ${selectedSentiment || "none"}`);
        renderDashboard();
      };

      container.appendChild(card);
      logDebug(`Rendered sentiment card for "${s.type}"`, card);
    });

    logInfo("✅ renderSentimentCards() completed successfully.");
  } catch (err) {
    logError("Error rendering sentiment cards:", err);
  }
};



// ==================== DETAILED BREAKDOWN ==================== //
const renderDetailedBreakdown = () => {
  logInfo("Starting renderDetailedBreakdown()...");

  try {
    const container = document.getElementById('detailed-breakdown-container');
    if (!container) {
      logError("Container #detailed-breakdown-container not found. Skipping breakdown.");
      return;
    }

    if (!selectedSentiment) {
      logInfo("No sentiment selected. Clearing breakdown container.");
      container.innerHTML = '';
      return;
    }

    // --- Data Filtering ---
    const filtered = commentsData.filter(c => c.sentiment === selectedSentiment);
    logDebug(`Filtered comments (${selectedSentiment}):`, filtered);

    const allStrong = filtered.filter(c => c.strength === 'strong');
    const allWeak = filtered.filter(c => c.strength === 'weak');
    const total = allStrong.length + allWeak.length || 1;

    const strongPercent = (allStrong.length / total * 100).toFixed(1);
    const weakPercent = (allWeak.length / total * 100).toFixed(1);

    const strongTop5 = allStrong.slice(0, 5);
    const weakTop5 = allWeak.slice(0, 5);

    // --- Color Config ---
    let colors;
    switch (selectedSentiment) {
      case 'positive': colors = ['#4ade80', '#86efac']; break;
      case 'neutral': colors = ['#facc15', '#fde68a']; break;
      case 'negative': colors = ['#f87171', '#fca5a5']; break;
      default: colors = ['#8884d8', '#82ca9d'];
    }

    // --- HTML Rendering ---
    const element = document.createElement('div');
    element.className = 'detailed-breakdown-card';
    element.innerHTML = `
      <div class="detailed-breakdown-header">
        <h2>Detailed Breakdown: ${selectedSentiment} (${filtered.length} Comments)</h2>
        <button id="close-breakdown" class="breakdown-close-btn">✖</button>
      </div>
      <div class="breakdown-grid">
        <div class="breakdown-chart-container">
          <h3>Strong vs Weak (%)</h3>
          <canvas style="width:100%;height:200px;" id="strength-chart"></canvas>
        </div>
        <div class="breakdown-comment-list" id="comment-list-container">
          <!-- Comments will appear on hover -->
        </div>
      </div>
    `;

    container.innerHTML = '';
    container.appendChild(element);
    logInfo("Rendered detailed breakdown card in DOM.");

    // --- ✅ Close Button ---
    const closeBtn = document.getElementById('close-breakdown');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        logInfo("Close breakdown button clicked.");
        selectedSentiment = null;
        container.innerHTML = '';
        const dashboard = document.getElementById('dashboard-section');
        if (dashboard) dashboard.style.display = 'block';
        renderDashboard();
        logInfo("Detailed breakdown closed successfully.");
      });
    }

    // --- Chart Rendering ---
    const ctx = safeGetContext('strength-chart');
    if (!ctx) {
      logError("Canvas context not found for #strength-chart. Skipping chart rendering.");
      return;
    }

    if (sentimentStrengthChart) sentimentStrengthChart.destroy();

    const commentListContainer = document.getElementById('comment-list-container');

    // --- Chart with Hover Interactivity (Hide on mouse leave) ---
    sentimentStrengthChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Strong', 'Weak'],
        datasets: [{
          label: 'Percentage',
          data: [strongPercent, weakPercent],
          backgroundColor: colors,
          borderRadius: 10
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.raw}%`
            }
          }
        },
        scales: {
          x: { beginAtZero: true, max: 100 },
          y: { grid: { display: false } }
        },
        // === 🧠 HOVER BEHAVIOR ===
        onHover: (event, activeElements) => {
          if (activeElements.length > 0) {
            const index = activeElements[0].index;
            if (index === 0) {
              commentListContainer.innerHTML = `
                <div>
                  <h4>Top Strong 🌟</h4>
                  <ul>${strongTop5.map(c => `<li>${c.text}</li>`).join('')}</ul>
                </div>
              `;
              logInfo("Hovered over Strong bar – showing strong comments.");
            } else if (index === 1) {
              commentListContainer.innerHTML = `
                <div>
                  <h4>Top Weak 📉</h4>
                  <ul>${weakTop5.map(c => `<li>${c.text}</li>`).join('')}</ul>
                </div>
              `;
              logInfo("Hovered over Weak bar – showing weak comments.");
            }
          } else {
            // 🧹 Clear comments when cursor leaves the bars
            commentListContainer.innerHTML = '';
            logInfo("Cursor left chart area – cleared comments.");
          }
        },
        hover: {
          mode: 'nearest',
          intersect: true
        }
      }
    });

    logInfo("✅ renderDetailedBreakdown() completed successfully with hover-hide behavior.");
  } catch (err) {
    logError("Error rendering detailed breakdown:", err);
  }
};




// ===== Render Advanced Overall Sentiment Doughnut Chart =====
// ===== Render Interactive Advanced Overall Sentiment Chart =====
const renderOverallSentimentChart = () => {
  logInfo("Starting render for Interactive Advanced Overall Sentiment Chart...");

  try {
    const counts = getSentimentCounts();
    logDebug("Fetched sentiment counts:", counts);

    // Calculate total and percentages
    const total = counts.positive + counts.neutral + counts.negative;
    if (total === 0) {
      logWarn("No sentiment data available for chart rendering.");
      return;
    }

    const positivePct = ((counts.positive / total) * 100).toFixed(1);
    const neutralPct = ((counts.neutral / total) * 100).toFixed(1);
    const negativePct = ((counts.negative / total) * 100).toFixed(1);

    // Detect dominant sentiment
    const sentimentPercentages = { Positive: positivePct, Neutral: neutralPct, Negative: negativePct };
    const [dominantSentiment, dominantValue] = Object.entries(sentimentPercentages).sort((a, b) => b[1] - a[1])[0];

    // Trend indicator (↑ ↓ ↔)
    let trendSymbol = "↔";
    if (dominantValue >= 60) trendSymbol = "↑";
    else if (dominantValue <= 30) trendSymbol = "↓";

    const ctx = safeGetContext("overall-sentiment-chart");
    if (!ctx) {
      logWarn("Canvas context not found for 'overall-sentiment-chart'. Skipping render.");
      return;
    }

    if (overallSentimentChart) {
      overallSentimentChart.destroy();
      logInfo("Destroyed old chart instance before rendering new one.");
    }

    // Center Text Plugin: Dominant Sentiment + Total Comments
    const centerTextPlugin = {
      id: "centerText",
      afterDraw(chart) {
        const { ctx, chartArea: { width, height } } = chart;
        ctx.save();
        ctx.font = "bold 18px sans-serif";
        ctx.fillStyle = "#1f2937";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${dominantSentiment} ${trendSymbol}`, width / 2, height / 2 - 10);
        ctx.font = "12px sans-serif";
        ctx.fillStyle = "#6b7280";
        ctx.fillText(`Total: ${total}`, width / 2, height / 2 + 15);
        ctx.restore();
      }
    };

    // Create the advanced doughnut chart
    overallSentimentChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: [
          `😊 Positive (${positivePct}%)`,
          `😐 Neutral (${neutralPct}%)`,
          `😞 Negative (${negativePct}%)`
        ],
        datasets: [{
          data: [positivePct, neutralPct, negativePct],
          backgroundColor: ["#22c55e", "#facc15", "#ef4444"],
          borderColor: "#fff",
          borderWidth: 2,
          hoverOffset: 15,
          spacing: 3,
          hoverBorderColor: "#000",
          hoverBorderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        cutout: "70%",
        rotation: -90,
        circumference: 360,
        animation: {
          animateRotate: true,
          animateScale: true,
          duration: 1500,
          easing: "easeOutElastic"
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: "#374151",
              font: { size: 14, weight: "500" },
              padding: 15
            }
          },
          tooltip: {
            backgroundColor: "#111827",
            titleColor: "#fff",
            bodyColor: "#fff",
            borderWidth: 1,
            borderColor: "#374151",
            padding: 10,
            usePointStyle: true,
            callbacks: {
              label: (ctx) => {
                const label = ctx.label || "";
                const value = ctx.formattedValue || "0";
                return ` ${label}: ${value}%`;
              }
            }
          }
        },
        hover: {
          mode: "nearest",
          intersect: true
        },
        onHover: (event, chartElement) => {
          event.native.target.style.cursor = chartElement.length ? "pointer" : "default";
        }
      },
      plugins: [centerTextPlugin]
    });

    logInfo("✅ Interactive Advanced Overall Sentiment Chart rendered successfully.");
  } catch (error) {
    logError("❌ Failed to render Interactive Advanced Overall Sentiment Chart.", error);
  }
};





// ===== Enhanced Render Timeline Chart =====
// ===== Render Timeline Chart (Smooth Spline + Gradient Style) =====
// ===== Render Timeline Chart (Stacked Area Style) =====
// ===== Render Timeline Chart (Smooth Spline + Gradient Style) =====
const renderTimelineChart = () => {
  logInfo("Starting smooth spline render for Timeline Chart...");

  try {
    const data = processTimelineData();
    logDebug("Processed timeline data:", data);

    const ctx = safeGetContext("timeline-chart");
    if (!ctx) {
      logInfo("Canvas context not found for 'timeline-chart'. Skipping render.");
      return;
    }

    if (timelineChart) {
      logInfo("Destroying existing Timeline Chart instance...");
      timelineChart.destroy();
    }

    // Prepare data arrays
    const labels = data.map(d => d.bin);
    const positives = data.map(d => d.positive);
    const neutrals = data.map(d => d.neutral);
    const negatives = data.map(d => d.negative);

    // Smooth gradient fills
    const gradPositive = ctx.createLinearGradient(0, 0, 0, 400);
    gradPositive.addColorStop(0, "rgba(52, 211, 153, 0.6)");   // teal-green
    gradPositive.addColorStop(1, "rgba(52, 211, 153, 0.05)");

    const gradNeutral = ctx.createLinearGradient(0, 0, 0, 400);
    gradNeutral.addColorStop(0, "rgba(147, 197, 253, 0.6)");   // soft blue
    gradNeutral.addColorStop(1, "rgba(147, 197, 253, 0.05)");

    const gradNegative = ctx.createLinearGradient(0, 0, 0, 400);
    gradNegative.addColorStop(0, "rgba(251, 146, 60, 0.6)");   // orange
    gradNegative.addColorStop(1, "rgba(251, 146, 60, 0.05)");

    // Create chart
    timelineChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Positive",
            data: positives,
            borderColor: "#10b981",
            backgroundColor: gradPositive,
            fill: true,
            cubicInterpolationMode: "monotone",
            borderWidth: 3,
            pointRadius: 3,
            pointBackgroundColor: "#10b981",
            pointHoverRadius: 5,
            order: 3
          },
          {
            label: "Neutral",
            data: neutrals,
            borderColor: "#3b82f6",
            backgroundColor: gradNeutral,
            fill: true,
            cubicInterpolationMode: "monotone",
            borderWidth: 3,
            pointRadius: 3,
            pointBackgroundColor: "#3b82f6",
            pointHoverRadius: 5,
            order: 2
          },
          {
            label: "Negative",
            data: negatives,
            borderColor: "#f97316",
            backgroundColor: gradNegative,
            fill: true,
            cubicInterpolationMode: "monotone",
            borderWidth: 3,
            pointRadius: 3,
            pointBackgroundColor: "#f97316",
            pointHoverRadius: 5,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            title: { display: true, text: "Video Progress (time)" },
            ticks: {
              callback: val => formatTime(labels[val]) || "",
              autoSkip: true,
              maxTicksLimit: 10
            },
            grid: { color: "rgba(0,0,0,0.05)" }
          },
          y: {
            stacked: true,
            title: { display: true, text: "Number of Comments" },
            beginAtZero: true,
            grid: { color: "rgba(0,0,0,0.05)" }
          }
        },
        plugins: {
          title: {
            display: true,
            text: "📈 Smooth Sentiment Timeline",
            color: "#111",
            font: { size: 18, weight: "bold" },
            padding: { bottom: 10 }
          },
          legend: {
            position: "top",
            labels: {
              usePointStyle: true,
              boxWidth: 12,
              color: "#333",
              font: { size: 13 }
            }
          },
          tooltip: {
            backgroundColor: "rgba(0,0,0,0.85)",
            titleColor: "#fff",
            bodyColor: "#fff",
            borderColor: "#333",
            borderWidth: 1,
            callbacks: {
              title: (items) => `⏱ ${formatTime(labels[items[0].dataIndex])}`,
              label: (item) => {
                const total =
                  positives[item.dataIndex] +
                  neutrals[item.dataIndex] +
                  negatives[item.dataIndex];
                const percent = total
                  ? ((item.parsed.y / total) * 100).toFixed(1)
                  : 0;
                return `${item.dataset.label}: ${item.parsed.y} (${percent}%)`;
              }
            }
          }
        },
        elements: {
          line: { tension: 0.4 } // adds slight smoothness on top
        }
      }
    });

    logInfo("✅ Smooth stacked Timeline Chart rendered successfully.");
  } catch (error) {
    logError("❌ Failed to render smooth Timeline Chart.", error);
  }
};










// ===== Render Topic Sentiment Chart =====
const renderTopicSentimentChart = () => {
  logInfo("Starting render for Topic Sentiment Chart...");
  try {
    const data = processTopicSentimentData();
    logDebug("Processed topic sentiment data:", data);

    const ctx = safeGetContext("topic-sentiment-chart");
    if (!ctx) {
      logInfo("Canvas context not found for 'topic-sentiment-chart'. Skipping render.");
      return;
    }

    if (topicSentimentChart) {
      logInfo("Destroying existing Topic Sentiment Chart instance...");
      topicSentimentChart.destroy();
    }

    topicSentimentChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(d => d.topic),
        datasets: [
          { label: "Positive", data: data.map(d => d.positive), backgroundColor: "#4ade80", stack: "Stack 0", borderRadius: 10 },
          { label: "Neutral", data: data.map(d => d.neutral), backgroundColor: "#facc15", stack: "Stack 0", borderRadius: 10 },
          { label: "Negative", data: data.map(d => d.negative), backgroundColor: "#f87171", stack: "Stack 0", borderRadius: 10 }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true } }
      }
    });

    logInfo("✅ Topic Sentiment Chart rendered successfully.");
  } catch (error) {
    logError("Failed to render Topic Sentiment Chart.", error);
  }
};



// ===== Render Word Cloud =====
const renderWordCloud = () => {
  logInfo("Starting render for Word Cloud...");
  try {
    const container = document.getElementById("word-cloud-container");
    container.innerHTML = "";

    const words = processWordCloudData();
    logDebug("Processed word cloud data:", words);

    words.forEach(w => {
      const span = document.createElement("span");
      span.textContent = w.word;
      span.style.cssText = `
        font-size:${w.size}em;
        transform:rotate(${w.rotation}deg);
        font-weight:${w.size > 2.5 ? "bold" : "normal"};
        color:hsl(${Math.random() * 360},70%,50%);
        transition:transform 0.3s;
        cursor:pointer;
      `;
      span.onmouseover = () => span.style.transform = `scale(1.1) rotate(${w.rotation}deg)`;
      span.onmouseout = () => span.style.transform = `scale(1) rotate(${w.rotation}deg)`;
      container.appendChild(span);
    });

    logInfo(`✅ Word Cloud rendered successfully with ${words.length} words.`);
  } catch (error) {
    logError("Failed to render Word Cloud.", error);
  }
};



// ===== Render Emoji Analysis =====
const renderEmojiAnalysis = () => {
  logInfo("Starting render for Emoji Analysis...");
  try {
    const container = document.getElementById("emoji-analysis-container");
    container.innerHTML = "";

    const emojis = processEmojiData();
    logDebug("Processed emoji data:", emojis);

    emojis.forEach(([emoji, count]) => {
      const div = document.createElement("div");
      div.className = "emoji-item";
      div.innerHTML = `<span class="icon">${emoji}</span><span class="count">${count}</span>`;
      container.appendChild(div);
    });

    logInfo(`✅ Emoji Analysis rendered successfully with ${emojis.length} emojis.`);
  } catch (error) {
    logError("Failed to render Emoji Analysis.", error);
  }
};



// ===== Render Top Comments =====
const renderTopComments = () => {
  logInfo("Starting render for Top Comments...");
  try {
    const container = document.getElementById("top-comments-container");
    container.innerHTML = "";

    if (!Array.isArray(commentsData)) {
      throw new Error("commentsData is not an array or not loaded yet.");
    }

    const topComments = commentsData.slice(0, 10);
    logDebug("Top 10 comments to render:", topComments);

    topComments.forEach(c => {
      const ts = formatTime(c.timestamp);
      const div = document.createElement("div");
      div.className = "comments-list-item";
      div.innerHTML = `
        <p class="text">${c.text}</p>
        <div class="meta">
          <span>Time: ${ts}</span>
          <span>${c.sentiment} (${c.strength})</span>
          <span>Topic: ${c.topic}</span>
        </div>
      `;
      container.appendChild(div);
    });

    logInfo(`✅ Top Comments rendered successfully with ${topComments.length} comments.`);
  } catch (error) {
    logError("Failed to render Top Comments.", error);
  }
};



// ===== MAIN RENDER DASHBOARD =====
const renderDashboard = () => {
  logInfo("🎯 Starting full dashboard render...");
  try {
    if (!Array.isArray(commentsData)) {
      throw new Error("commentsData is undefined or not loaded yet.");
    }

    document.getElementById("total-comments-count").textContent = commentsData.length;
    logDebug(`Total comments count updated: ${commentsData.length}`);

    renderSentimentCards();
    if (selectedSentiment) {
      logInfo(`Rendering Detailed Breakdown for selected sentiment: ${selectedSentiment}`);
      renderDetailedBreakdown();
    }

    renderOverallSentimentChart();
    renderTimelineChart();
    renderTopicSentimentChart();
    renderWordCloud();
    renderEmojiAnalysis();
    renderTopComments();

    logInfo("✅ Dashboard rendered successfully.");
  } catch (error) {
    logError("Failed to render Dashboard.", error);
  }
};
