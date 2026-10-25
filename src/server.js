import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { FireflyClient } from "./client.js";
import { FireflyDaemon } from "./daemon.js";
import { configManager, resolveDataPath, OUTPUT_DIR, ROOT_DIR } from "./config.js";
import { scheduleDailyCleanup } from "./cleanup.js";

const PORT = process.env.PORT || 5055;

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

// Static file hosting for dashboard and generated images
app.use(express.static(path.join(ROOT_DIR, "public")));
app.use("/output", express.static(OUTPUT_DIR));
if (fs.existsSync(path.join(ROOT_DIR, "output"))) {
  app.use("/output", express.static(path.join(ROOT_DIR, "output")));
}

// Start automatic 7-day rolling cleanup
scheduleDailyCleanup(OUTPUT_DIR, 7);

const client = new FireflyClient({
  outputDir: OUTPUT_DIR
});

const daemon = new FireflyDaemon({
  sessionFile: resolveDataPath("session.json"),
  tokenFile: resolveDataPath("token.json"),
  onTokenUpdate: (newToken) => {
    client.token = newToken;
    console.log("[Server] Client token synced from Daemon.");
  }
});

// Auto-start daemon if session.json exists
const sessionFilePath = resolveDataPath("session.json");
if (fs.existsSync(sessionFilePath)) {
  daemon.start().catch(err => {
    console.error("[Server] Auto-start daemon error:", err.message);
  });
}

// -------------------------------------------------------------
// Authentication Middleware
// -------------------------------------------------------------
function requireAuth(req, res, next) {
  const apiKey = req.headers["x-api-key"] || req.headers.authorization;
  if (apiKey && configManager.verifyApiKey(apiKey)) {
    return next();
  }

  const sessionToken = req.headers["x-session-token"];
  if (sessionToken && configManager.verifySession(sessionToken)) {
    return next();
  }

  return res.status(401).json({
    error: "Unauthorized",
    message: "Valid Master API Key or Admin Session required."
  });
}

// -------------------------------------------------------------
// Auth & Key Management Endpoints
// -------------------------------------------------------------

// Login endpoint
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  if (configManager.verifyAdmin(username, password)) {
    const sessionToken = configManager.createSession();
    return res.json({
      success: true,
      sessionToken,
      apiKey: configManager.getApiKey()
    });
  }

  return res.status(401).json({ error: "Invalid username or password" });
});

// Logout endpoint
app.post("/api/logout", (req, res) => {
  const sessionToken = req.headers["x-session-token"] || req.body.sessionToken;
  if (sessionToken) {
    configManager.destroySession(sessionToken);
  }
  res.json({ success: true, message: "Logged out successfully" });
});

// Check auth status
app.get("/api/auth/check", requireAuth, (req, res) => {
  res.json({
    authenticated: true,
    apiKey: configManager.getApiKey()
  });
});

// Update Admin Password
app.post("/api/admin/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const result = configManager.updateAdminPassword(currentPassword, newPassword);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json({ success: true, message: "Admin password updated successfully." });
});

// Get active API Key
app.get("/api/key", requireAuth, (req, res) => {
  res.json({ apiKey: configManager.getApiKey() });
});

// Reset / Overwrite API Key (Single Key Strategy)
app.post("/api/key/reset", requireAuth, (req, res) => {
  const newKey = configManager.resetApiKey();
  res.json({
    success: true,
    apiKey: newKey,
    message: "Master API key has been reset and overwritten."
  });
});

// -------------------------------------------------------------
// Service Endpoints
// -------------------------------------------------------------

// 1. Health & Status (Public for quick connection probing)
app.get("/api/status", async (req, res) => {
  const tokenFile = resolveDataPath("token.json");
  let tokenInfo = { valid: false, remainingHours: 0, expiresAt: null };

  if (fs.existsSync(tokenFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
      let expDate = null;
      if (data.expire) {
        expDate = new Date(data.expire);
      } else if (data.token) {
        const parts = data.token.split(".");
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
          if (payload.created_at && payload.expires_in) {
            expDate = new Date(Number(payload.created_at) + Number(payload.expires_in));
          }
        }
      }

      if (expDate) {
        const diffMs = expDate.getTime() - Date.now();
        tokenInfo = {
          valid: diffMs > 0,
          remainingHours: Math.max(0, Math.round(diffMs / 3600000)),
          expiresAt: expDate.toISOString(),
          tokenExcerpt: data.token ? `${data.token.slice(0, 15)}...${data.token.slice(-10)}` : null
        };
      }
    } catch (e) {}
  }

  res.json({
    status: "ok",
    daemonStatus: daemon.status,
    lastCheck: daemon.lastCheckTime,
    token: tokenInfo
  });
});

// 2. Credits Balance (Protected)
app.get("/v1/credits/balance", requireAuth, async (req, res) => {
  try {
    const balance = await client.getBalance();
    res.json(balance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Generate Image (Protected)
app.post("/v1/images/generate", requireAuth, async (req, res) => {
  const { prompt, aspect = "auto", quality = "medium", modelId, modelVersion } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const startTime = Date.now();
  try {
    const result = await client.generateImage({
      prompt,
      aspect,
      quality,
      modelId,
      modelVersion
    });

    res.json({
      success: true,
      prompt,
      aspect,
      imageUrl: `/output/${path.basename(result.filePath)}`,
      presignedUrl: result.presignedUrl,
      imagePath: result.filePath,
      latencyMs: Date.now() - startTime
    });
  } catch (err) {
    res.status(500).json({ error: err.message, latencyMs: Date.now() - startTime });
  }
});

// 4. Session Sync from Extension (Protected)
app.post("/api/session/sync", requireAuth, async (req, res) => {
  const sessionData = req.body;
  if (!sessionData || !sessionData.cookies) {
    return res.status(400).json({ error: "Invalid session payload" });
  }

  try {
    await daemon.updateSession(sessionData);
    if (sessionData.tokenData && sessionData.tokenData.token) {
      client.token = sessionData.tokenData.token;
    }
    res.json({
      success: true,
      message: "Session successfully updated. Daemon reloaded."
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Manual Token Override (Protected)
app.post("/api/token/manual", requireAuth, (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Token string required" });
  }

  client.setToken(token);
  res.json({ success: true, message: "Token manually set." });
});

// 6. Supported Models with Live Credit Costs
app.get("/v1/models", (req, res) => {
  res.json([
    {
      "group": "Adobe Models (Commercially Safe)",
      "id": "image5-generate",
      "name": "Firefly Image 5",
      "cost": 10,
      "free": false,
      "resolution": "1K / 2K"
    },
    {
      "group": "Adobe Models (Commercially Safe)",
      "id": "clio-v4-ultra",
      "name": "Firefly Image 4 Ultra",
      "cost": 20,
      "free": false,
      "resolution": "1K / 2K"
    },
    {
      "group": "Adobe Models (Commercially Safe)",
      "id": "clio-v4-standard",
      "name": "Firefly Image 4",
      "cost": 0,
      "free": true,
      "resolution": "1K / 2K"
    },
    {
      "group": "Adobe Models (Commercially Safe)",
      "id": "clio-v3-standard",
      "name": "Firefly Image 3",
      "cost": 0,
      "free": true,
      "resolution": "1K / 2K"
    },
    {
      "group": "Partner Models — Google",
      "id": "nano-banana-3",
      "name": "Gemini 3.1 (Nano Banana 2)",
      "cost": 20,
      "free": false,
      "resolution": "1K / 2K"
    },
    {
      "group": "Partner Models — Google",
      "id": "nano-banana-2026-09",
      "name": "Gemini Nano Banana 2.1",
      "cost": 10,
      "free": false,
      "resolution": "1K"
    },
    {
      "group": "Partner Models — Google",
      "id": "gemini-flash-2",
      "name": "Gemini 3 (Nano Banana Pro)",
      "cost": 40,
      "free": false,
      "resolution": "1K / 2K"
    },
    {
      "group": "Partner Models — OpenAI",
      "id": "gpt-image-2-5-prism",
      "name": "GPT Image 2.5 Sunburst",
      "cost": 5,
      "free": false,
      "resolution": "1K / 2K"
    },
    {
      "group": "Partner Models — OpenAI",
      "id": "gpt-image-2-5-flare",
      "name": "GPT Image 2.5 Flare",
      "cost": 15,
      "free": false,
      "resolution": "1K / 2K"
    },
    {
      "group": "Partner Models — OpenAI",
      "id": "gpt-image-2",
      "name": "GPT Image 2",
      "cost": 20,
      "free": false,
      "resolution": "1K"
    },
    {
      "group": "Partner Models — OpenAI",
      "id": "gpt-image-1-5",
      "name": "GPT Image 1.5",
      "cost": 10,
      "free": false,
      "resolution": "1K"
    },
    {
      "group": "Partner Models — OpenAI",
      "id": "gpt4o",
      "name": "GPT Image 1",
      "cost": 60,
      "free": false,
      "resolution": "1K / 2K"
    },
    {
      "group": "Partner Models — Black Forest Labs (FLUX)",
      "id": "flux-2-pro",
      "name": "FLUX.2 [pro]",
      "cost": 20,
      "free": false,
      "resolution": "1K / 2K"
    },
    {
      "group": "Partner Models — Black Forest Labs (FLUX)",
      "id": "flux-pro-ultra",
      "name": "FLUX1.1 [pro] Ultra Raw",
      "cost": 20,
      "free": false,
      "resolution": "2K"
    },
    {
      "group": "Partner Models — Black Forest Labs (FLUX)",
      "id": "flux-1-1",
      "name": "FLUX1.1 [pro]",
      "cost": 10,
      "free": false,
      "resolution": "1K"
    },
    {
      "group": "Partner Models — Black Forest Labs (FLUX)",
      "id": "flux-kontext-max",
      "name": "FLUX.1 Kontext [max]",
      "cost": 20,
      "free": false,
      "resolution": "1K / 2K"
    },
    {
      "group": "Partner Models — Black Forest Labs (FLUX)",
      "id": "flux-kontext-pro",
      "name": "FLUX.1 Kontext [pro]",
      "cost": 10,
      "free": false,
      "resolution": "1K"
    },
    {
      "group": "Partner Models — Cinematic & Photoreal",
      "id": "runway-gen4",
      "name": "Runway Gen-4 Image",
      "cost": 40,
      "free": false,
      "resolution": "1K / 2K"
    },
    {
      "group": "Partner Models — Cinematic & Photoreal",
      "id": "foundry-humain",
      "name": "HUMAIN Image 1",
      "cost": 50,
      "free": false,
      "resolution": "2K"
    }
  ]);
});

app.listen(PORT, () => {
  const masterKey = configManager.getApiKey();
  console.log(`\n======================================================`);
  console.log(`🔥 Firefly API Server & Dashboard running at:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`🔑 Master API Key: ${masterKey}`);
  console.log(`👤 Admin Username: admin | Default Password: admin`);
  console.log(`======================================================\n`);
});
