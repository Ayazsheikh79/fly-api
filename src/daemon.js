import { chromium } from "playwright";
import fs from "fs";
import { resolveDataPath } from "./config.js";

const SESSION_FILE = resolveDataPath("session.json");
const TOKEN_FILE = resolveDataPath("token.json");

/**
 * On-Demand Firefly Session & Token Manager
 * Playwright is NEVER kept open 24/7.
 * It is ONLY launched on-demand when a token is expired and needs refreshing from session cookies.
 */
export class FireflyDaemon {
  constructor(options = {}) {
    this.sessionFile = options.sessionFile || SESSION_FILE;
    this.tokenFile = options.tokenFile || TOKEN_FILE;
    this.onTokenUpdate = options.onTokenUpdate || null;
    this.isRefreshing = false;
    this.refreshPromise = null;
    this.status = "idle";
    this.lastCheckTime = null;
  }

  // Backwards-compatible start method (doesn't launch browser now)
  start() {
    this.status = "idle";
    console.log("[Daemon] On-demand token manager active (Playwright remains closed until needed).");
  }

  /**
   * Helper to check if current token in token.json is valid
   * @param {number} minRemainingMinutes - Buffer before considering expired (default: 5 mins)
   */
  isTokenValid(minRemainingMinutes = 5) {
    if (!fs.existsSync(this.tokenFile)) return false;

    try {
      const data = JSON.parse(fs.readFileSync(this.tokenFile, "utf8"));
      if (!data.token) return false;

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

      if (!expDate) return true; // Assume valid if no expiry parseable

      const remainingMs = expDate.getTime() - Date.now();
      return remainingMs > minRemainingMinutes * 60 * 1000;
    } catch (e) {
      return false;
    }
  }

  /**
   * Ensure a valid token exists.
   * If expired, launches ephemeral Playwright, refreshes via cookies, and IMMEDIATELY CLOSES IT.
   * @returns {Promise<string>} Valid token
   */
  async ensureValidToken() {
    if (this.isTokenValid()) {
      const data = JSON.parse(fs.readFileSync(this.tokenFile, "utf8"));
      return data.token;
    }

    // Deduplicate simultaneous refresh requests
    if (this.isRefreshing && this.refreshPromise) {
      return await this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = this._refreshOnce()
      .finally(() => {
        this.isRefreshing = false;
        this.refreshPromise = null;
      });

    return await this.refreshPromise;
  }

  /**
   * Ephemeral 15-second Playwright run
   */
  async _refreshOnce() {
    this.status = "refreshing";
    this.lastCheckTime = new Date().toISOString();
    console.log("[Daemon] Token expired or missing. Launching ephemeral Playwright to refresh...");

    if (!fs.existsSync(this.sessionFile)) {
      this.status = "error: no_session";
      throw new Error("No Adobe session cookies found. Please open firefly.adobe.com in Chrome and click 'Sync Session' in the extension.");
    }

    let sessionData;
    try {
      sessionData = JSON.parse(fs.readFileSync(this.sessionFile, "utf8"));
    } catch (e) {
      this.status = "error: invalid_session_file";
      throw new Error("Corrupt session.json. Please re-sync via Chrome extension.");
    }

    if (!sessionData.cookies || sessionData.cookies.length === 0) {
      this.status = "error: empty_cookies";
      throw new Error("No session cookies stored. Please re-sync via Chrome extension.");
    }

    let browser = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--blink-settings=imagesEnabled=false"
        ]
      });

      const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 }
      });

      // Restore cookies
      const formattedCookies = sessionData.cookies.map(c => {
        const cookieObj = {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || "/",
          secure: true,
          httpOnly: !!c.httpOnly
        };
        if (c.sameSite === "no_restriction") cookieObj.sameSite = "None";
        else if (c.sameSite === "strict") cookieObj.sameSite = "Strict";
        else cookieObj.sameSite = "Lax";

        if (c.expirationDate) cookieObj.expires = c.expirationDate;
        return cookieObj;
      });

      await context.addCookies(formattedCookies);

      // Restore localStorage
      await context.addInitScript(({ local }) => {
        try {
          if (local) {
            for (const [k, v] of Object.entries(local)) {
              window.localStorage.setItem(k, v);
            }
          }
        } catch (e) {}
      }, { local: sessionData.localStorage || {} });

      const page = await context.newPage();

      // Block non-essential assets
      await page.route("**/*", route => {
        const type = route.request().resourceType();
        if (["image", "media", "font", "stylesheet"].includes(type)) {
          return route.abort();
        }
        return route.continue();
      });

      console.log("[Daemon] Navigating to https://firefly.adobe.com to capture refreshed token...");
      await page.goto("https://firefly.adobe.com", {
        waitUntil: "domcontentloaded",
        timeout: 40000
      });

      // Poll page for adobeIMS token up to 15 seconds
      let refreshedToken = null;
      let expireTime = null;

      for (let i = 0; i < 15; i++) {
        const imsData = await page.evaluate(() => {
          try {
            return window.adobeIMS?.getAccessToken();
          } catch (e) {
            return null;
          }
        });

        if (imsData && imsData.token) {
          refreshedToken = imsData.token;
          expireTime = imsData.expire;
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      if (!refreshedToken) {
        throw new Error("Adobe session cookies expired or invalid. Please re-authenticate on firefly.adobe.com and sync extension.");
      }

      // Save fresh token
      const tokenPayload = {
        token: refreshedToken,
        expire: expireTime,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.tokenFile, JSON.stringify(tokenPayload, null, 2));

      if (this.onTokenUpdate) {
        this.onTokenUpdate(refreshedToken);
      }

      console.log(`[Daemon] Token refreshed successfully! Expires: ${expireTime}`);
      this.status = "idle";
      return refreshedToken;

    } finally {
      // ALWAYS kill browser completely
      if (browser) {
        await browser.close().catch(() => {});
        console.log("[Daemon] Ephemeral browser closed. Resources released to 0%.");
      }
    }
  }

  /**
   * When extension sends session data:
   * Direct token save without opening browser!
   */
  async updateSession(sessionData) {
    fs.writeFileSync(this.sessionFile, JSON.stringify(sessionData, null, 2));

    // If extension provided the token directly, save it immediately!
    if (sessionData.tokenData && sessionData.tokenData.token) {
      console.log("[Daemon] Direct token received from Chrome extension!");
      const tokenPayload = {
        token: sessionData.tokenData.token,
        expire: sessionData.tokenData.expire,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.tokenFile, JSON.stringify(tokenPayload, null, 2));

      if (this.onTokenUpdate) {
        this.onTokenUpdate(sessionData.tokenData.token);
      }
      return tokenPayload;
    }

    // Otherwise refresh once on demand
    return await this.ensureValidToken();
  }
}
