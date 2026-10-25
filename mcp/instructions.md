# Adobe Firefly Microservice — Agent & MCP Guide

This MCP server provides programmatic access to an autonomous Adobe Firefly AI generation microservice with 19 models, serial queuing, and multi-reference image composition.

## 🌟 Core Capabilities & Tools

### 1. `firefly_generate_image`
Generates high-fidelity AI images. Requests are automatically enqueued serially (concurrency: 1) with an automatic 5-second cooldown to protect account hygiene and prevent upstream `408 System Under Load` errors.

#### Parameters:
* `prompt` (string, required): Detailed visual description of what to render.
* `model_id` (string, optional, default: `"gpt-image-2-5-prism"`):
  * **GPT Image 2.5 Sunburst (`gpt-image-2-5-prism`)**: Default model. High-aesthetic photorealism, textures, and prompt adherence (5 credits).
  * **Firefly Image 4 (`clio-v4-standard`)**: Native Adobe model. **0 credits (FREE)**. Excellent for editorial, vectors, and reference image workflows.
  * **Firefly Image 3 (`clio-v3-standard`)**: Native Adobe model. **0 credits (FREE)**.
  * **Firefly Image 4 Ultra (`clio-v4-ultra`)**: High dynamic range & photorealism (20 credits).
  * **Gemini 3.1 / Nano Banana 2 (`nano-banana-3`)**: Google model (20 credits).
  * **FLUX.2 [pro] (`flux-2-pro`)**: Black Forest Labs high-end diffusion (20 credits).
  * **Runway Gen-4 (`runway-gen4`)**: Cinematic aesthetic (40 credits).
* `aspect` (string, optional, default: `"auto"`):
  * `"auto"` (1024x1024 square)
  * `"3:4"` (Vertical poster / character art, 1024x1360)
  * `"16:9"` (Landscape widescreen, 1344x768)
  * `"9:16"` (Mobile vertical / story / reel, 768x1344)
  * `"1:1"` (Square, 1024x1024)
  * `"4:3"` (Standard display, 1184x896)
* `quality` (string, optional, default: `"medium"`):
  * `"medium"`: 5 credits on GPT Sunburst.
  * `"high"`: 15 credits on GPT Sunburst (maximum detail pass).
* `reference_images` (array of strings, optional):
  * Up to 4 reference image URLs, local file paths, base64 strings, or Adobe asset UUIDs.
* `reference_usage` (string, optional, default: `"subject"`):
  * `"subject"`: Preserves identity/character structure from the reference.
  * `"style"`: Transfers color palette, art medium, lighting, and mood.
  * `"structure"`: Guides composition and edge layout.

### 2. `firefly_get_balance`
Returns real-time credit balance:
* `available`: Remaining credits in active cycle.
* `total`: Monthly quota cap (e.g. 4,000).
* `used`: Consumed credits.

### 3. `firefly_get_status`
Returns daemon health, token countdown hours, and active queue length.

### 4. `firefly_list_models`
Returns complete JSON catalog of all 19 supported models categorized by engine and credit costs.

---

## 💡 Best Practices for Agents

1. **Credit Conservation**:
   * For everyday tasks, mockups, or general visuals, prefer `clio-v4-standard` (Free 0 credits) or `gpt-image-2-5-prism` (Cost-effective at 5 credits).
   * Reserve `flux-2-pro` (20 cr) and `runway-gen4` (40 cr) for high-end cinematic photorealism when requested.
2. **Reference Image Workflows**:
   * If a user provides an existing image to base a generation on, pass its local absolute path or URL in `reference_images`.
   * For character consistency, use Native models (`clio-v4-standard`) with `reference_usage: "subject"`.
3. **Queue Awareness**:
   * Because the server enforces serial execution with 5-second cooldowns, do not spam multiple parallel tool calls in one turn; await each response before initiating the next generation.
