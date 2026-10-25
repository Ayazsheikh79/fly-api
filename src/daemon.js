import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { resolveDataPath } from "./config.js";
const SESSION_FILE = resolveDataPath("session.json");
const TOKEN_FILE = resolveDataPath("token.json");

export class FireflyDaemon {
  constructor(options = {}) {
    this.sessionFile = options.sessionFile || SESSION_FILE;
    this.tokenFile = options.tokenFile || TOKEN_FILE;
    this.onTokenUpdate = options.onTokenUpdate || null;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.checkInterval = null;
    this.isRunning = false;
    this.currentToken = null;
    this.lastCheckTime = null;
    this.status = "stopped";
  }

  async start() {
    if (this.isRunning) return;
    this.status = "starting";
    console.log("[Daemon] Starting Headless Firefly Daemon...");

    try {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process",
          "--disable-background-networking",
          "--disable-background-timer-throttling=false",
          "--disable-renderer-backgrounding=false",
          "--blink-settings=imagesEnabled=false"
        ]
      });

      this.context = await this.browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 }
      });

      // Load session state if available
      let sessionData = null;
      if (fs.existsSync(this.sessionFile)) {
        try {
          sessionData = JSON.parse(fs.readFileSync(this.sessionFile, "utf8"));
        } catch (e) {
          console.error("[Daemon] Error parsing session.json:", e.message);
        }
      }

      if (sessionData && sessionData.cookies && sessionData.cookies.length > 0) {
        console.log(`[Daemon] Restoring ${sessionData.cookies.length} cookies...`);
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

        await this.context.addCookies(formattedCookies);

        // Pre-populate storage before page scripts execute
        await this.context.addInitScript(({ local, session }) => {
          try {
            if (local) {
              for (const [k, v] of Object.entries(local)) {
                window.localStorage.setItem(k, v);
              }
            }
            if (session) {
              for (const [k, v] of Object.entries(session)) {
                window.sessionStorage.setItem(k, v);
              }
            }
          } catch (e) {}
        }, { local: sessionData.localStorage, session: sessionData.sessionStorage });
      } else {
        console.warn("[Daemon] No session.json found. Waiting for first session sync...");
      }

      this.page = await this.context.newPage();
      console.log("[Daemon] Navigating to https://firefly.adobe.com...");
      await this.page.goto("https://firefly.adobe.com", {
        waitUntil: "domcontentloaded",
        timeout: 45000
      }).catch(err => {
        console.warn("[Daemon] Initial navigation notice:", err.message);
      });

      this.isRunning = true;
      this.status = "running";
      console.log("[Daemon] Daemon active. Starting periodic token refresh monitor.");

      // Check token immediately after load
      await this.checkAndRefreshToken();

      // Check every 5 minutes
      this.checkInterval = setInterval(() => this.checkAndRefreshToken(), 5 * 60 * 1000);

    } catch (err) {
      this.status = "error: " + err.message;
      console.error("[Daemon] Failed to start:", err);
    }
  }

  async checkAndRefreshToken() {
    if (!this.page || this.page.isClosed()) return;
    this.lastCheckTime = new Date().toISOString();

    try {
      const imsData = await this.page.evaluate(() => {
        try {
          return window.adobeIMS?.getAccessToken();
        } catch (e) {
          return null;
        }
      });

      if (imsData && imsData.token) {
        if (this.currentToken !== imsData.token) {
          this.currentToken = imsData.token;
          console.log(`[Daemon] Token updated! Expires at: ${imsData.expire}`);

          fs.writeFileSync(this.tokenFile, JSON.stringify({
            token: imsData.token,
            expire: imsData.expire,
            sid: imsData.sid,
            updatedAt: new Date().toISOString()
          }, null, 2));

          if (this.onTokenUpdate) {
            this.onTokenUpdate(imsData.token, imsData);
          }
        }
      }
    } catch (err) {
      console.warn("[Daemon] Token poll check error:", err.message);
    }
  }

  async updateSession(newSessionData) {
    console.log("[Daemon] Updating session state hot in-memory...");
    fs.writeFileSync(this.sessionFile, JSON.stringify(newSessionData, null, 2));

    if (newSessionData.tokenData && newSessionData.tokenData.token) {
      this.currentToken = newSessionData.tokenData.token;
      fs.writeFileSync(this.tokenFile, JSON.stringify({
        token: newSessionData.tokenData.token,
        expire: newSessionData.tokenData.expire,
        sid: newSessionData.tokenData.sid,
        updatedAt: new Date().toISOString()
      }, null, 2));
    }

    if (!this.isRunning || !this.context || !this.page) {
      await this.start();
      return;
    }

    try {
      await this.context.clearCookies();
      if (newSessionData.cookies && newSessionData.cookies.length > 0) {
        const formattedCookies = newSessionData.cookies.map(c => {
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
        await this.context.addCookies(formattedCookies);
      }

      await this.page.evaluate(({ local, session }) => {
        try {
          if (local) {
            for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
          }
          if (session) {
            for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v);
          }
          location.reload();
        } catch (e) {}
      }, { local: newSessionData.localStorage, session: newSessionData.sessionStorage });

      console.log("[Daemon] Hot reload completed. Page reloaded with fresh credentials.");
      setTimeout(() => this.checkAndRefreshToken(), 5000);
    } catch (e) {
      console.error("[Daemon] Hot reload error:", e.message);
    }
  }

  async stop() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.browser) await this.browser.close().catch(() => {});
    this.isRunning = false;
    this.status = "stopped";
    console.log("[Daemon] Stopped.");
  }
}
