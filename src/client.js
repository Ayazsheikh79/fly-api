const MODEL_MAP = {
  // Google Nano Banana
  "nano-banana-3": { type: "3p", modelId: "gemini-flash", modelVersion: "nano-banana-3" },
  "nano-banana-2026-09": { type: "3p", modelId: "gemini-flash", modelVersion: "nano_banana_2026_09" },
  "gemini-flash-2": { type: "3p", modelId: "gemini-flash", modelVersion: "gemini_flash_2" },

  // OpenAI GPT Image
  "gpt-image-2-5-prism": { type: "3p", modelId: "gpt-image", modelVersion: "gpt-image-2.5-prism" },
  "gpt-image-2-5-flare": { type: "3p", modelId: "gpt-image", modelVersion: "gpt-image-2.5-flare" },
  "gpt-image-2": { type: "3p", modelId: "gpt-image", modelVersion: "gpt-image-2" },
  "gpt-image-1-5": { type: "3p", modelId: "gpt-image", modelVersion: "gpt-image-1.5" },
  "gpt4o": { type: "3p", modelId: "gpt-4o-image", modelVersion: "default" },

  // Black Forest Labs FLUX
  "flux-2-pro": { type: "3p", modelId: "flux", modelVersion: "flux-2-pro" },
  "flux-pro-ultra": { type: "3p", modelId: "fluxUltra", modelVersion: "default" },
  "flux-1-1": { type: "3p", modelId: "flux", modelVersion: "flux-1.1" },
  "flux-kontext-max": { type: "3p", modelId: "flux", modelVersion: "flux-kontext-max" },
  "flux-kontext-pro": { type: "3p", modelId: "flux", modelVersion: "flux-kontext-pro" },

  // Adobe Native Models (Different Endpoint & Payload!)
  "clio-v4-standard": { type: "native", modelVersion: "image4_standard" },
  "clio-v4-ultra": { type: "native", modelVersion: "image4_ultra" },
  "clio-v3-standard": { type: "native", modelVersion: "image3_standard" },
  "image5-generate": { type: "native", modelVersion: "image5_generate" },
  "clio-v5-lora": { type: "native", modelVersion: "image4_standard" },

  // Cinematic & Photoreal
  "runway-gen4": { type: "3p", modelId: "runway-gen4-image", modelVersion: "default" },
  "foundry-humain": { type: "3p", modelId: "humain", modelVersion: "default" }
};

import fs from "fs";
import path from "path";
import { resolveDataPath, OUTPUT_DIR } from "./config.js";

// 3P Aspect Ratios
const ASPECT_RATIOS_3P = {
  "auto": null,
  "2:3": { width: 1024, height: 1536 },
  "tall": { width: 1024, height: 1536 },
  "3:4": { width: 1024, height: 1365 },
  "portrait": { width: 1024, height: 1365 },
  "4:5": { width: 1024, height: 1280 },
  "1:1": { width: 1024, height: 1024 },
  "square": { width: 1024, height: 1024 },
  "16:9": { width: 1792, height: 1024 },
  "landscape": { width: 1792, height: 1024 },
  "9:16": { width: 1024, height: 1792 }
};

// Native Firefly Exact Supported Aspect Ratios
const ASPECT_RATIOS_NATIVE = {
  "auto": { width: 1792, height: 2304 },
  "3:4": { width: 1792, height: 2304 },
  "portrait": { width: 1792, height: 2304 },
  "4:5": { width: 1792, height: 2304 },
  "2:3": { width: 1792, height: 2688 },
  "tall": { width: 1792, height: 2688 },
  "1:1": { width: 1024, height: 1024 },
  "square": { width: 1024, height: 1024 },
  "16:9": { width: 2688, height: 1536 },
  "landscape": { width: 2688, height: 1536 },
  "9:16": { width: 1440, height: 2560 }
};

export class FireflyClient {
  constructor(options = {}) {
    this.token = options.token || this.resolveToken();
    this.apiKey = options.apiKey || "clio-playground-web";
    this.outputDir = options.outputDir || OUTPUT_DIR;

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  resolveToken() {
    if (process.env.ADOBE_FIREFLY_TOKEN) {
      return process.env.ADOBE_FIREFLY_TOKEN.trim();
    }

    const tokenFile = resolveDataPath("token.json");
    if (fs.existsSync(tokenFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
        if (data.token) return data.token.trim();
      } catch (e) {}
    }

    const envFile = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, "utf8");
      const match = content.match(/^ADOBE_FIREFLY_TOKEN=(.+)$/m);
      if (match) return match[1].trim();
    }

    return null;
  }

  setToken(token) {
    this.token = token.trim();
    const tokenFile = resolveDataPath("token.json");
    fs.writeFileSync(tokenFile, JSON.stringify({ token: this.token, updatedAt: new Date().toISOString() }, null, 2));
  }

  async getBalance() {
    if (!this.token) throw new Error("No token configured");
    const res = await fetch("https://firefly.adobe.io/v1/credits/balance", {
      headers: {
        "authorization": `Bearer ${this.token}`,
        "content-type": "application/json",
        "accept": "application/json",
        "x-api-key": "SunbreakWebUI1"
      }
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch balance (${res.status}): ${err}`);
    }
    const data = await res.json();
    return {
      available: data.total?.quota?.available ?? data.total?.availableCredits ?? 0,
      total: data.total?.quota?.total ?? data.total?.provisionedCredits ?? 4000,
      used: data.total?.quota?.used ?? 0,
      raw: data
    };
  }

  /**
   * Unified generation supporting both Native Firefly and 3P Partner Models
   */
  async generateImage(params) {
    if (!this.token) {
      throw new Error("No Adobe Firefly Token found. Please authenticate or sync session.");
    }

    const {
      prompt,
      modelId = "clio-v4-standard",
      aspect = "auto",
      quality = "medium",
      addWatermark = false,
      seed = Math.floor(Math.random() * 900000) + 10000,
    } = params;

    const mapped = MODEL_MAP[modelId] || { type: "native", modelVersion: "image4_standard" };
    const startTime = Date.now();

    // Resolve sherlockToken for session fingerprint
    let arpSessionId = "eyJzaWQiOiJjMzA5MTUyOS0wMzU2LTQ0Y2YtOTY0My0xOGZmMWUxYjNmZGEiLCJmdHIiOiIyOTBmZjVlMWY5MTg0ZWZmYTliNWE3NGJiOWI5OTkzM18xNzkyOTExMzA0NjgzX19VREY0My1tNF8zMWNrX3d5bTFIaWNITk5vPS01MDYzLXYyX3R0IiwiYXJrIjoiNzExMThlMWIzNTUxZmNkOTkuNDE4Mjg4ODkwNHxyPWFwLXNvdXRoZWFzdC0xfG1ldGE9M3xtZXRhYmdjbHI9dHJhbnNwYXJlbnR8bWV0YWljb25jbHI9JTIzNzU3NTc1fGd1aXRleHRjb2xvcj0lMjMwMDAwMDB8cGs9QkJDQzMxNEMtNDkzNy00Q0NELUIwQTMtRkRGMEYwRjc2MDNDfGF0PTQwfHN1cD0xfHJpZD0yOHxhZz0xMDF8Y2RuX3VybD1odHRwcyUzQSUyRiUyRmFya3MtY2xpZW50LmFkb2JlLmNvbSUyRmNkbiUyRmZjfHN1cmw9aHR0cHMlM0ElMkYlMkZhcmtzLWNsaWVudC5hZG9iZS5jb20lMkZjZG4lMkZmYyUyRmFzc2V0cyUyRnN0eWxlLW1hbmFnZXIiLCJiZnAiOiJhOGUxYThiNS05ZDA0LTQ4ZDAtOTM2My1hMzQwODg3OTY1NjgifQ==";
    const sessionFile = resolveDataPath("session.json");
    if (fs.existsSync(sessionFile)) {
      try {
        const s = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
        if (s.cookies) {
          const st = s.cookies.find(c => c.name === "sherlockToken");
          if (st && st.value) arpSessionId = st.value;
        }
      } catch (e) {}
    }

    let targetUrl;
    let payload;

    if (mapped.type === "native") {
      // 1. NATIVE ADOBE FIREFLY PIPELINE
      targetUrl = "https://image-v4.ff.adobe.io/v2/images/generate-async";
      const nativeSize = ASPECT_RATIOS_NATIVE[aspect] || ASPECT_RATIOS_NATIVE["auto"];

      payload = {
        seeds: [seed, seed + 1, seed + 2, seed + 3],
        size: nativeSize,
        prompt: prompt,
        detailLevel: "full",
        modelVersion: mapped.modelVersion,
        caiClaimVersion: 2,
        output: { storeInputs: true },
        negativePrompt: "",
        visualIntensity: 8,
        styles: { presets: [], strength: 50 },
        locale: "en-US",
        promptEnhance: "on"
      };
    } else {
      // 2. 3P PARTNER MODELS PIPELINE (Google, OpenAI, FLUX, Runway, Humain)
      targetUrl = "https://firefly-3p.ff.adobe.io/v2/3p-images/generate-async";
      const size3p = ASPECT_RATIOS_3P[aspect];

      payload = {
        n: 1,
        seeds: [seed],
        output: { storeInputs: true },
        prompt: prompt,
        referenceBlobs: [],
        caiClaimVersion: 2,
        modelSpecificPayload: (aspect === "auto" || !size3p) ? { size: "auto" } : (mapped.modelId === "gemini-flash" ? { parameters: { addWatermark: Boolean(addWatermark) } } : {}),
        modelId: mapped.modelId,
        modelVersion: mapped.modelVersion,
        generationMetadata: {
          module: "text2image",
          submodule: "ff-image-generate"
        },
        generationSettings: {
          detailLevel: quality === "high" ? 5 : 3
        }
      };

      if (aspect && aspect !== "auto") {
        payload.size = { aspect: aspect };
      }
    }

    // Submit Request with retry
    let submitRes;
    for (let retry = 0; retry < 4; retry++) {
      const nonce = require("crypto").randomBytes(32).toString("hex");
      submitRes = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${this.token}`,
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "x-arp-session-id": arpSessionId,
          "x-nonce": nonce,
          "origin": "https://firefly.adobe.com",
          "referer": "https://firefly.adobe.com/",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
        },
        body: JSON.stringify(payload)
      });

      if (submitRes.status === 408) {
        console.warn(`[Firefly] System under load (408), retrying attempt ${retry + 1}/4 in 2.5s...`);
        await new Promise(r => setTimeout(r, 2500));
        continue;
      }
      break;
    }

    if (!submitRes.ok) {
      const err = await submitRes.text();
      throw new Error(`Firefly Submit Failed (${submitRes.status}): ${err}`);
    }

    const job = await submitRes.json();
    const pollUrl = job.links?.result?.href;
    if (!pollUrl) {
      throw new Error(`No poll URL returned: ${JSON.stringify(job)}`);
    }

    // Poll for Completion
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
      attempts++;
      await new Promise(r => setTimeout(r, 2000));

      const pollRes = await fetch(pollUrl, {
        headers: {
          "authorization": `Bearer ${this.token}`,
          "x-api-key": this.apiKey
        }
      });

      if (pollRes.status === 200) {
        const resultData = await pollRes.json();
        
        // Immediate failure handling
        if (resultData.error_code || (resultData.message && !resultData.outputs && !resultData.links)) {
          throw new Error(resultData.message || resultData.error_code);
        }

        if (resultData.outputs && resultData.outputs.length > 0) {
          const presignedUrl = resultData.outputs[0].image?.presignedUrl;
          const imageId = resultData.outputs[0].image?.id || `firefly_${Date.now()}`;
          const elapsedSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));

          // Download the finished image
          const imgRes = await fetch(presignedUrl);
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const fileName = `firefly_${mapped.modelVersion}_${Date.now()}.png`;
          const filePath = path.join(this.outputDir, fileName);
          fs.writeFileSync(filePath, buffer);

          return {
            id: imageId,
            filePath,
            presignedUrl,
            elapsedSeconds,
            model: mapped.type === "native" ? `firefly/${mapped.modelVersion}` : `${mapped.modelId}/${mapped.modelVersion}`
          };
        }
      }
    }

    throw new Error(`Timed out waiting for Firefly image generation after ${maxAttempts} attempts.`);
  }
}