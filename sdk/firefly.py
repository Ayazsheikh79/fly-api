"""
Official Firefly Python SDK
"""
import os
import base64
import requests
from typing import Optional, List, Dict, Union

class Firefly:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: int = 120
    ):
        self.base_url = (base_url or os.getenv("FIREFLY_API_URL") or "http://localhost:5055").rstrip("/")
        self.api_key = api_key or os.getenv("FIREFLY_API_KEY")
        self.timeout = timeout

        if not self.api_key:
            print("[Firefly SDK] Warning: No api_key provided. Set FIREFLY_API_KEY or pass api_key to constructor.")

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
        if self.api_key:
            headers["x-api-key"] = self.api_key
        return headers

    def get_status(self) -> dict:
        """Check connection status, token validity & queue load"""
        r = requests.get(f"{self.base_url}/api/status", timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    def get_balance(self) -> dict:
        """Check remaining credit balance"""
        r = requests.get(f"{self.base_url}/v1/credits/balance", headers=self._headers(), timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    def get_models(self) -> list:
        """List all available models and their real-time credit costs"""
        r = requests.get(f"{self.base_url}/v1/models", timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    def upload_reference(self, image: Union[str, bytes], mime_type: str = "image/png") -> dict:
        """
        Upload an image to be used as a reference
        :param image: File path, base64 data string, or binary bytes
        :param mime_type: "image/png" or "image/jpeg"
        :return: {"success": True, "assetId": "...", "bytes": ...}
        """
        if isinstance(image, bytes):
            b64_str = f"data:{mime_type};base64,{base64.b64encode(image).decode('utf-8')}"
        elif isinstance(image, str) and os.path.isfile(image):
            ext = os.path.splitext(image)[1].lower()
            detected_mime = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
            with open(image, "rb") as f:
                b64_str = f"data:{detected_mime};base64,{base64.b64encode(f.read()).decode('utf-8')}"
        else:
            b64_str = image

        r = requests.post(
            f"{self.base_url}/v1/storage/upload",
            headers=self._headers(),
            json={"image": b64_str, "mimeType": mime_type},
            timeout=self.timeout
        )
        r.raise_for_status()
        return r.json()

    def generate(
        self,
        prompt: str,
        model_id: str = "gpt-image-2-5-prism",
        aspect: str = "auto",
        quality: str = "medium",
        reference_images: Optional[List[Union[dict, str]]] = None,
        reference_image: Optional[str] = None,
        reference_usage: str = "subject"
    ) -> dict:
        """
        Generate an image through the serial queue
        """
        payload = {
            "prompt": prompt,
            "modelId": model_id,
            "aspect": aspect,
            "quality": quality,
            "referenceUsage": reference_usage
        }
        if reference_images:
            payload["referenceImages"] = reference_images
        if reference_image:
            payload["referenceImage"] = reference_image

        r = requests.post(
            f"{self.base_url}/v1/images/generate",
            headers=self._headers(),
            json=payload,
            timeout=self.timeout
        )
        r.raise_for_status()
        return r.json()
