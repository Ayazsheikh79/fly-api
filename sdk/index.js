import fs from "fs";
import path from "path";

/**
 * Official Firefly Client SDK (Node.js / ESM & CJS compatible)
 */
export class Firefly {
  /**
   * @param {Object} options
   * @param {string} options.baseUrl - Base URL of your Firefly API server (default: http://localhost:5055)
   * @param {string} options.apiKey - Your Master API Key
   * @param {number} [options.timeoutMs] - Request timeout in ms (default: 120000)
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || process.env.FIREFLY_API_URL || "http://localhost:5055").replace(/\/+$/, "");
    this.apiKey = options.apiKey || process.env.FIREFLY_API_KEY;
    this.timeoutMs = options.timeoutMs || 120000;

    if (!this.apiKey) {
      console.warn("[Firefly SDK] Warning: No apiKey provided. Set FIREFLY_API_KEY or pass apiKey in constructor.");
    }
  }

  async _request(endpoint, method = "GET", body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      "Accept": "application/json"
    };

    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const init = { method, headers };
    if (body) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    init.signal = controller.signal;

    try {
      const res = await fetch(url, init);
      clearTimeout(timeout);

      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        data = { message: await res.text() };
      }

      if (!res.ok) {
        const errorMsg = data.error || data.message || `Request failed with status ${res.status}`;
        const err = new Error(errorMsg);
        err.status = res.status;
        err.response = data;
        throw err;
      }

      return data;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        throw new Error(`[Firefly SDK] Request timeout after ${this.timeoutMs}ms: ${url}`);
      }
      throw err;
    }
  }

  /**
   * Check connection status, token validity & queue load
   */
  async getStatus() {
    return await this._request("/api/status");
  }

  /**
   * Check remaining credit balance
   */
  async getBalance() {
    return await this._request("/v1/credits/balance");
  }

  /**
   * List all available models and their real-time credit costs
   */
  async getModels() {
    return await this._request("/v1/models");
  }

  /**
   * Upload an image to be used as a reference
   * @param {string|Buffer} image - File path, base64 string, data URL or Buffer
   * @param {string} [mimeType="image/png"]
   * @returns {Promise<{success: boolean, assetId: string, bytes: number}>}
   */
  async uploadReference(image, mimeType = "image/png") {
    let payloadImage = "";

    if (Buffer.isBuffer(image)) {
      payloadImage = `data:${mimeType};base64,${image.toString("base64")}`;
    } else if (typeof image === "string") {
      if (image.startsWith("data:image/")) {
        payloadImage = image;
      } else if (fs.existsSync(image)) {
        const buffer = fs.readFileSync(image);
        const ext = path.extname(image).toLowerCase();
        const detectedMime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
        payloadImage = `data:${detectedMime};base64,${buffer.toString("base64")}`;
      } else {
        payloadImage = image;
      }
    }

    return await this._request("/v1/storage/upload", "POST", {
      image: payloadImage,
      mimeType
    });
  }

  /**
   * Generate an image through the serial queue
   * @param {Object} params
   * @param {string} params.prompt - Text description
   * @param {string} [params.modelId="gpt-image-2-5-prism"] - e.g. "gpt-image-2-5-prism", "clio-v4-standard"
   * @param {string} [params.aspect="auto"] - "auto", "1:1", "16:9", "9:16", "3:4", "4:3"
   * @param {string} [params.quality="medium"] - "medium" (5cr) or "high" (15cr)
   * @param {Array<Object|string>} [params.referenceImages] - Array of up to 4 reference images/IDs
   * @param {string|Buffer} [params.referenceImage] - Convenience single reference image/ID
   * @param {"subject"|"style"|"structure"} [params.referenceUsage="subject"]
   * @returns {Promise<{success: boolean, imageUrl: string, presignedUrl: string, imagePath: string, model: string, latencyMs: number}>}
   */
  async generate(params) {
    if (!params || !params.prompt) {
      throw new Error("[Firefly SDK] prompt is required for generation.");
    }
    return await this._request("/v1/images/generate", "POST", params);
  }
}

export default Firefly;
