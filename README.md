# 🔥 Firefly API — Standalone Production Microservice

[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![API](https://img.shields.io/badge/API-RESTful-orange.svg)](#api-reference)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

A high-performance, self-contained REST API microservice and administrative dashboard for **Adobe Firefly** and **Frontier 3P Partner Models** (OpenAI GPT Image 2.5 Sunburst, Black Forest Labs FLUX, Google Gemini Nano Banana, Runway, and Humain).

Built for automated pipelines, backend bots (Instagram/Discord/Telegram), and developer tools with **zero-friction VPS deployment**, **server-side authentication**, **brute-force rate limiting**, and **automated storage hygiene**.

---

## 🌟 Key Highlights

* **Dual Engine Architecture**:
  * **Native Adobe Models (`clio-v4-standard`, `image4_ultra`, `image3_standard`)**: Consumes **0 credits (FREE unlimited daily fair use)**.
  * **Third-Party Partner Models (`gpt-image-2.5-prism`, `flux-2-pro`, `nano-banana-3`)**: Direct access to OpenAI, FLUX, and Google models at only 5–20 credits.
* **Default Flagship Model**:
  * Calls default automatically to **GPT Image 2.5 Sunburst (`gpt-image-2.5-prism`)** with `auto` aspect ratio and `medium` quality (5 credits).
* **Zero-Config Docker Deployment**:
  * No manual `.env` file setup required on your VPS. Simply run `docker compose up -d`. All data, credentials, and tokens auto-bootstrap into a persistent host volume (`./data`).
* **True Server-Side Authentication**:
  * `dashboard.html` is strictly guarded on the server. Unauthenticated requests are redirected with `HTTP 302` to `/login`. No static leaks or DOM inspection bypasses.
* **Brute-Force Attack Defense**:
  * Integrated **5-strike IP lockout** (15-minute ban) and a **1,000ms forced tarpit delay** on failed login attempts.
* **Single Master API Key Strategy**:
  * 1 cryptographically secure key (`ff_live_...`) for all programmatic access. Easily copied or instantly rotated from the UI or REST API.
* **7-Day Rolling Storage Auto-Cleanup**:
  * Automatically scans and deletes generated PNGs older than 7 days, maintaining a permanently lean VPS disk footprint (~50–150 MB).
* **Companion Chrome Extension**:
  * 1-click cookie and Bearer token capture from `firefly.adobe.com`, syncing directly to local or remote VPS instances.

---

## 🏗️ System Architecture

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      Client Applications / Bots                        │
 │           (ytservice, Instagram Bots, Discord Bots, cURL)              │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
                   Header: `x-api-key: ff_live_...`
                                     │
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      Firefly API Server (:5055)                        │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │ Auth Middleware (Single Master API Key or HttpOnly Session)     │  │
 │  └─────────────────────────────────┬────────────────────────────────┘  │
 │                                    │                                   │
 │       ┌────────────────────────────┴───────────────────────────┐       │
 │       ▼                                                        ▼       │
 │ [ Native Engine Router ]                             [ 3P Partner Router ]│
 │ Endpoint: image-v4.ff.adobe.io                       Endpoint: firefly-3p.ff.adobe.io │
 │ Models: Image 4, Image 4 Ultra                       Models: GPT Sunburst, FLUX, Gemini│
 │ Cost: 0 Credits (FREE)                               Cost: 5 - 20 Credits     │
 └───────┬────────────────────────────────────────────────────────┬───────┘
         │                                                        │
         ▼                                                        ▼
 ┌───────────────────────────────────┐  ┌─────────────────────────────────┐
 │ Persistent Volume: ./data/output  │  │ Background Storage Cleanup      │
 │ (Local Lossless PNG Cache)        │  │ (Auto-purges files > 7 days)    │
 └───────────────────────────────────┘  └─────────────────────────────────┘
```

---

## 🚀 1-Minute VPS Deployment

### Prerequisites
* Docker & Docker Compose installed on your Linux VPS / Server.

### Step 1: Clone Repository
```bash
git clone <your-repo-url> firefly-api
cd firefly-api
```

### Step 2: Start Container
```bash
docker compose up -d
```
*Docker will create `./data` on your host and automatically bootstrap `data/config.json` with:*
* **Username**: `admin`
* **Default Password**: `admin`
* **Master API Key**: `ff_live_<random_hex>`

### Step 3: Open Dashboard
Navigate to `http://YOUR_VPS_IP:5055/` in your browser.
1. Sign in with `admin` / `admin`.
2. Go to **Security & API Key** to copy your Master API Key and change your password.

---

## 📡 API Reference

All programmatic endpoints require authentication via header:
* `x-api-key: YOUR_MASTER_KEY` OR
* `Authorization: Bearer YOUR_MASTER_KEY`

---

### 1. Generate Image
`POST /v1/images/generate`

#### Request Body
| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `prompt` | `string` | **Required** | The text description of the image to generate. |
| `modelId` | `string` | `"gpt-image-2.5-prism"` | Model identifier (see catalog below). |
| `aspect` | `string` | `"auto"` | Aspect ratio: `"auto"`, `"3:4"`, `"1:1"`, `"16:9"`, `"9:16"`, `"2:3"`, `"4:5"`. |
| `quality` | `string` | `"medium"` | Quality level: `"medium"` (5 cr) or `"high"` (15 cr). |

#### Example: Minimal Request (Uses Defaults)
```bash
curl -X POST http://localhost:5055/v1/images/generate \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_MASTER_KEY" \
  -d '{
    "prompt": "Solo Leveling Sung Jinwoo shadow monarch anime news poster, 3:4 vertical"
  }'
```

#### Example: Custom Request (Native Firefly — 0 Credits)
```bash
curl -X POST http://localhost:5055/v1/images/generate \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_MASTER_KEY" \
  -d '{
    "prompt": "Cyberpunk Neo Tokyo street in rainy reflection, Makoto Shinkai style",
    "modelId": "clio-v4-standard",
    "aspect": "3:4"
  }'
```

#### Response Format (HTTP 200)
```json
{
  "success": true,
  "prompt": "Solo Leveling Sung Jinwoo shadow monarch anime news poster...",
  "aspect": "3:4",
  "imageUrl": "/output/firefly_gpt-image-2.5-prism_1792916608422.png",
  "presignedUrl": "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/images/...",
  "imagePath": "/app/data/output/firefly_gpt-image-2.5-prism_1792916608422.png",
  "latencyMs": 18254
}
```

---

### 2. Upload Reference Image (Max 4)
`POST /v1/storage/upload`

Directly upload a reference image to Adobe storage and receive an asset ID.

#### Request Body
```json
{
  "image": "data:image/png;base64,iVBORw0KGgo...",
  "mimeType": "image/png"
}
```

#### Response (HTTP 200)
```json
{
  "success": true,
  "assetId": "95e1a214-0fc2-4f7b-bd65-102dd56a9785",
  "mimeType": "image/png",
  "bytes": 27472
}
```

---

### 3. Generate Image with References
`POST /v1/images/generate`

You can attach reference images by:
* **Asset ID**: Returned from `/v1/storage/upload`
* **Data URL / Base64**
* **Public URL** (fetched & uploaded in background)
* **Local File Path**

```bash
curl -X POST http://localhost:5055/v1/images/generate \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_MASTER_KEY" \
  -d '{
    "prompt": "futuristic crystal flower hologram in dark void",
    "modelId": "clio-v4-standard",
    "referenceImages": [
      { "id": "95e1a214-0fc2-4f7b-bd65-102dd56a9785", "usage": "subject" }
    ]
  }'
```

*(Note: Maximum 4 reference images allowed per request. Native Firefly models support subject, style, and structure).*

---

### 4. Check Credit Balance
`GET /v1/credits/balance`

```bash
curl http://localhost:5055/v1/credits/balance \
  -H "x-api-key: YOUR_MASTER_KEY"
```

#### Response
```json
{
  "available": 2334,
  "total": 4000,
  "used": 1666
}
```

---

### 5. Service Status, Token & Queue Health (Public)
`GET /api/status`

```bash
curl http://localhost:5055/api/status
```

#### Response
```json
{
  "status": "ok",
  "daemonStatus": "running",
  "token": {
    "valid": true,
    "remainingHours": 20,
    "expiresAt": "2026-10-26T03:37:17.076Z"
  }
}
```

---

### 6. Reset / Rotate Master API Key
`POST /api/key/reset`

Immediately revokes the previous key and generates a new one.

```bash
curl -X POST http://localhost:5055/api/key/reset \
  -H "x-api-key: YOUR_CURRENT_KEY"
```

---

## 🎨 Supported Models Catalog

| Model ID | Display Name | Engine | Quality / Detail | Credit Cost |
| :--- | :--- | :--- | :--- | :--- |
| **`gpt-image-2-5-prism`** *(Default)* | **GPT Image 2.5 Sunburst** | OpenAI 3P | Medium / High | **5 cr** / 15 cr |
| `clio-v4-standard` | **Firefly Image 4** | Native Adobe | Full | **0 cr (FREE)** |
| `clio-v4-ultra` | **Firefly Image 4 Ultra** | Native Adobe | Full | 20 cr |
| `clio-v3-standard` | **Firefly Image 3** | Native Adobe | Full | **0 cr (FREE)** |
| `gpt-image-2-5-flare` | GPT Image 2.5 Flare | OpenAI 3P | Medium / High | 15 cr |
| `flux-2-pro` | FLUX.2 [pro] | Black Forest 3P | Standard | 20 cr |
| `flux-pro-ultra` | FLUX1.1 [pro] Ultra | Black Forest 3P | Raw 2K | 20 cr |
| `flux-1-1` | FLUX1.1 [pro] | Black Forest 3P | Standard | 10 cr |
| `nano-banana-3` | Gemini 3.1 (Nano Banana 2)| Google 3P | Standard | 20 cr |
| `nano-banana-2026-09` | Gemini Nano Banana 2.1 | Google 3P | Standard | 10 cr |
| `gemini-flash-2` | Gemini 3 (Nano Banana Pro)| Google 3P | Standard | 40 cr |
| `runway-gen4` | Runway Gen-4 Image | Runway 3P | Standard | 40 cr |
| `foundry-humain` | HUMAIN Image 1 | Foundry 3P | 2K Studio | 50 cr |

---

## 💻 SDK Integration Examples

### Node.js (Fetch / Axios)
```javascript
async function generateVisual(prompt) {
  const res = await fetch("http://YOUR_VPS_IP:5055/v1/images/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.FIREFLY_API_KEY
    },
    body: JSON.stringify({
      prompt: prompt,
      aspect: "3:4"
    })
  });

  const data = await res.json();
  if (!data.success) throw new Error(data.error);

  console.log("Local Image URL:", `http://YOUR_VPS_IP:5055${data.imageUrl}`);
  console.log("Direct Adobe Presigned S3 URL:", data.presignedUrl);
  return data;
}
```

### Python (Requests)
```python
import requests

def generate_image(prompt: str):
    url = "http://YOUR_VPS_IP:5055/v1/images/generate"
    headers = {
        "x-api-key": "YOUR_MASTER_KEY"
    }
    payload = {
        "prompt": prompt,
        "modelId": "gpt-image-2-5-prism",
        "aspect": "3:4"
    }
    response = requests.post(url, json=payload, headers=headers)
    response.raise_for_status()
    result = response.json()
    print("Download URL:", result["presignedUrl"])
    return result
```

---

---

## 📦 Official SDKs (Node.js & Python)

The repository provides zero-dependency native SDKs for your applications in [`sdk/`](sdk/).

### Node.js (ESM / TypeScript)
```javascript
import { Firefly } from "./sdk/index.js";

const firefly = new Firefly({
  baseUrl: "http://YOUR_VPS_IP:5055",
  apiKey: "YOUR_MASTER_KEY"
});

// Check balance
const balance = await firefly.getBalance();
console.log("Remaining Credits:", balance.available);

// Generate image (Default: GPT Sunburst - 5 cr)
const result = await firefly.generate({
  prompt: "cyberpunk detective in rainy alleyway, neon signage",
  aspect: "3:4"
});
console.log("Local Image:", result.imageUrl);
console.log("Presigned S3 URL:", result.presignedUrl);
```

### Python (3.8+)
```python
from sdk.firefly import Firefly

firefly = Firefly(
    base_url="http://YOUR_VPS_IP:5055",
    api_key="YOUR_MASTER_KEY"
)

# Check status
status = firefly.get_status()
print("Token valid:", status["token"]["valid"])

# Generate image
result = firefly.generate(
    prompt="futuristic hovercar over cyberpunk city",
    aspect="16:9",
    model_id="clio-v4-standard" # Free 0 cr
)
print("Image URL:", result["imageUrl"])
```

---

## 🤖 Model Context Protocol (MCP) Server

Connect your Firefly microservice directly to AI coding assistants (**Antigravity**, **Claude Desktop**, **Cursor**) using standard MCP over STDIO.

### MCP Tools Provided:
1. **`firefly_generate_image`**: Text-to-image generation with aspect, quality, model, and reference image support.
2. **`firefly_get_balance`**: Check remaining plan credits and quota reset date.
3. **`firefly_get_status`**: Check connection health, token countdown, and queue load.
4. **`firefly_list_models`**: List all 19 AI models and their live credit costs.

### Configuration for Claude Desktop / Antigravity / Cursor
Add to your `claude_desktop_config.json` or agent configuration:

```json
{
  "mcpServers": {
    "firefly": {
      "command": "node",
      "args": ["/path/to/firefly-api/mcp/server.js"],
      "env": {
        "FIREFLY_API_URL": "http://YOUR_VPS_IP:5055",
        "FIREFLY_API_KEY": "YOUR_MASTER_KEY"
      }
    }
  }
}
```

## 🧩 Chrome Companion Extension

The unpacked extension in [`extension/`](extension/) enables 1-click token updates:

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the [`extension/`](extension/) directory.
4. Click the Firefly icon in your browser toolbar:
   * **Server URL**: Set to `http://YOUR_VPS_IP:5055` (or `http://localhost:5055`).
   * **Master API Key**: Paste your master key.
5. Navigate to `https://firefly.adobe.com` in Chrome and click **⚡ Update & Sync Session**.
6. The extension captures your active 24-hour Bearer token + cookies and updates your VPS daemon instantly.

---

## 🛡️ Admin Password & Lockout Recovery

If you ever forget your password or lock out your IP:

### 1. CLI Reset (Fastest)
```bash
# On your VPS host:
npm run reset-admin

# Inside Docker:
docker exec -it firefly-api npm run reset-admin
```
*Resets username to `admin` and password to `admin`, while clearing all IP bans.*

### 2. Master API Key Reset
```bash
curl -X POST http://YOUR_VPS_IP:5055/api/admin/password \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_MASTER_KEY" \
  -d '{"newPassword": "myNewPassword123"}'
```

### 3. Direct Host Edit
```bash
nano data/config.json
```
Edit `"password": "myNewPassword"` directly in the file. Changes take effect immediately.

---

## 📄 License
MIT License. Commercially safe for personal and enterprise workflows.
