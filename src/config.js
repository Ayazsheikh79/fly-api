import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, "data");

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const CONFIG_FILE = path.join(DATA_DIR, "config.json");
export const OUTPUT_DIR = path.join(DATA_DIR, "output");
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

export function resolveDataPath(filename) {
  // Check DATA_DIR first, then ROOT_DIR for backward compatibility
  const primary = path.join(DATA_DIR, filename);
  const fallback = path.join(ROOT_DIR, filename);
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(fallback)) return fallback;
  return primary;
}

function generateRandomKey(prefix = "ff_live_") {
  return `${prefix}${crypto.randomBytes(24).toString("hex")}`;
}

export class ConfigManager {
  constructor() {
    this.activeSessions = new Set();
    this.init();
  }

  init() {
    if (!fs.existsSync(CONFIG_FILE)) {
      const initialConfig = {
        admin: {
          username: "admin",
          password: "admin"
        },
        apiKey: generateRandomKey(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2), "utf8");
      console.log("[Config] Initialized config.json with default admin credentials and Master API Key.");
    }
  }

  loadConfig() {
    try {
      if (!fs.existsSync(CONFIG_FILE)) {
        this.init();
      }
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    } catch (err) {
      console.error("[Config] Error reading config.json:", err.message);
      return {
        admin: { username: "admin", password: "admin" },
        apiKey: "ff_live_default_key"
      };
    }
  }

  saveConfig(data) {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), "utf8");
  }

  verifyAdmin(username, password) {
    const config = this.loadConfig();
    return (
      config.admin &&
      config.admin.username === username &&
      config.admin.password === password
    );
  }

  updateAdminPassword(currentPassword, newPassword) {
    const config = this.loadConfig();
    if (!config.admin || config.admin.password !== currentPassword) {
      return { success: false, error: "Incorrect current password." };
    }
    if (!newPassword || newPassword.trim().length < 4) {
      return { success: false, error: "New password must be at least 4 characters long." };
    }

    config.admin.password = newPassword.trim();
    this.saveConfig(config);
    return { success: true };
  }

  getApiKey() {
    const config = this.loadConfig();
    return config.apiKey;
  }

  resetApiKey() {
    const config = this.loadConfig();
    const newKey = generateRandomKey();
    config.apiKey = newKey;
    this.saveConfig(config);
    console.log(`[Config] Master API Key reset: ${newKey.slice(0, 14)}...`);
    return newKey;
  }

  createSession() {
    const sessionToken = `ff_sess_${crypto.randomBytes(24).toString("hex")}`;
    this.activeSessions.add(sessionToken);
    return sessionToken;
  }

  verifySession(sessionToken) {
    if (!sessionToken) return false;
    return this.activeSessions.has(sessionToken);
  }

  destroySession(sessionToken) {
    this.activeSessions.delete(sessionToken);
  }

  verifyApiKey(providedKey) {
    if (!providedKey) return false;
    const cleanKey = providedKey.trim().replace(/^Bearer\s+/i, "");
    const config = this.loadConfig();
    return cleanKey === config.apiKey;
  }
}

export const configManager = new ConfigManager();
