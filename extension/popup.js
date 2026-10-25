const DOMAINS_TO_CAPTURE = [
  "adobe.com",
  "adobelogin.com",
  "services.adobe.com",
  "identity.adobe.com"
];

const connBadge = document.getElementById("connBadge");
const tokenExpiryEl = document.getElementById("tokenExpiry");
const creditsStatEl = document.getElementById("creditsStat");
const serverUrlInput = document.getElementById("serverUrl");
const apiKeyInput = document.getElementById("apiKeyInput");
const statusBox = document.getElementById("statusBox");

const updateBtn = document.getElementById("updateBtn");
const dashBtn = document.getElementById("dashBtn");

function showStatus(text, type = "info") {
  statusBox.className = `status-msg show status-${type}`;
  statusBox.textContent = text;
}

function getCleanServerUrl() {
  return serverUrlInput.value.trim().replace(/\/$/, "");
}

function getApiKey() {
  return apiKeyInput.value.trim();
}

function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  const key = getApiKey();
  if (key) {
    headers["x-api-key"] = key;
  }
  return headers;
}

// Check server connectivity and active token
async function checkServerHealth() {
  const serverUrl = getCleanServerUrl();
  try {
    const res = await fetch(`${serverUrl}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    connBadge.className = "badge badge-connected";
    connBadge.innerHTML = `<span class="dot dot-green"></span> Connected`;

    if (data.token && data.token.valid) {
      tokenExpiryEl.textContent = `Active (~${data.token.remainingHours}h left)`;
      tokenExpiryEl.style.color = "#15803d";
    } else {
      tokenExpiryEl.textContent = "Expired / None";
      tokenExpiryEl.style.color = "#dc2626";
    }

    // Also fetch balance with auth header if key provided
    try {
      const bRes = await fetch(`${serverUrl}/v1/credits/balance`, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(3000)
      });
      if (bRes.ok) {
        const bData = await bRes.json();
        if (bData.available !== undefined) {
          creditsStatEl.textContent = `${bData.available.toLocaleString()} / ${bData.total.toLocaleString()}`;
          creditsStatEl.style.color = "#1e293b";
        }
      } else if (bRes.status === 401) {
        creditsStatEl.textContent = "Requires API Key";
        creditsStatEl.style.color = "#d97706";
      }
    } catch (be) {}

  } catch (err) {
    connBadge.className = "badge badge-disconnected";
    connBadge.innerHTML = `<span class="dot dot-red"></span> Disconnected`;
    tokenExpiryEl.textContent = "Server Offline";
    tokenExpiryEl.style.color = "#64748b";
    creditsStatEl.textContent = "—";
  }
}

// 1-Click Update & Sync Session
updateBtn.addEventListener("click", async () => {
  const serverUrl = getCleanServerUrl();
  const apiKey = getApiKey();

  if (!serverUrl) {
    showStatus("Please enter a valid Server URL!", "error");
    return;
  }

  await chrome.storage.local.set({ savedServerUrl: serverUrl, savedApiKey: apiKey });
  showStatus("Reading active Firefly session...", "info");
  updateBtn.disabled = true;

  try {
    // 1. Find Firefly or Adobe tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let targetTab = activeTab;

    if (!targetTab || !targetTab.url || !targetTab.url.includes("adobe.com")) {
      const adobeTabs = await chrome.tabs.query({ url: "*://*.adobe.com/*" });
      if (adobeTabs && adobeTabs.length > 0) {
        targetTab = adobeTabs[0];
      } else {
        showStatus("Please open firefly.adobe.com in your browser first!", "error");
        updateBtn.disabled = false;
        return;
      }
    }

    // 2. Read multi-domain cookies
    const allCookies = [];
    const seenKeys = new Set();
    for (const domain of DOMAINS_TO_CAPTURE) {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const c of cookies) {
        const key = `${c.domain}:${c.name}:${c.path}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allCookies.push(c);
        }
      }
    }

    // 3. Read LocalStorage, SessionStorage & AdobeIMS Token
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: () => {
        const local = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          local[k] = localStorage.getItem(k);
        }
        const session = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          session[k] = sessionStorage.getItem(k);
        }
        const ims = window.adobeIMS?.getAccessToken();
        return { local, session, ims };
      }
    });

    const pageData = execResult ? execResult.result : {};

    const sessionPayload = {
      capturedAt: new Date().toISOString(),
      cookies: allCookies,
      localStorage: pageData.local || {},
      sessionStorage: pageData.session || {},
      tokenData: pageData.ims || null
    };

    // 4. Send directly to Server (VPS) with API Key Header
    showStatus(`Sending session to ${serverUrl}...`, "info");
    const res = await fetch(`${serverUrl}/api/session/sync`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(sessionPayload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showStatus("⚡ Synced successfully! Server daemon updated.", "success");
      await checkServerHealth();
    } else {
      showStatus(`Sync error: ${data.error || data.message || res.statusText}`, "error");
    }

  } catch (err) {
    showStatus(`Error: ${err.message}`, "error");
  } finally {
    updateBtn.disabled = false;
  }
});

// Open Dashboard Button
dashBtn.addEventListener("click", () => {
  const serverUrl = getCleanServerUrl();
  if (serverUrl) {
    chrome.tabs.create({ url: serverUrl });
  }
});

// Save settings on change
serverUrlInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ savedServerUrl: getCleanServerUrl() });
  checkServerHealth();
});

apiKeyInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ savedApiKey: getApiKey() });
  checkServerHealth();
});

// Init
(async () => {
  const { savedServerUrl, savedApiKey } = await chrome.storage.local.get(["savedServerUrl", "savedApiKey"]);
  if (savedServerUrl) {
    serverUrlInput.value = savedServerUrl;
  }
  if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
  }
  checkServerHealth();
})();
