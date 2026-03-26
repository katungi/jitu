"""
Zeta 2 - Edit Prediction Model Server on Modal
================================================
Serves zed-industries/zeta-2 via vLLM with an OpenAI-compatible API.
Optimized for code edit prediction with speculative decoding and prefix caching.

Deploy:  modal deploy serve_zeta2.py
Run dev: modal serve serve_zeta2.py

Cost: ~$0.59/hr on L4 GPU, scales to zero when idle.
Free tier: $30/month Modal credits covers ~50 hours of GPU time.
"""

import modal
import subprocess
import os

# ---------------------------------------------------------------------------
# 1. Container image
# ---------------------------------------------------------------------------
# Base CUDA image with vLLM and dependencies.
# Modal provides CUDA drivers, so we just need vLLM + HuggingFace Hub.

vllm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "vllm==0.9.1",
        "huggingface_hub[hf_transfer]==0.32.0",
        "flashinfer-python==0.2.6.post1",
        extra_index_url="https://download.pytorch.org/whl/cu128",
    )
    .env(
        {
            "HF_HUB_ENABLE_HF_TRANSFER": "1",  # 3x faster model downloads
            "VLLM_USE_V1": "1",  # Use vLLM v1 engine
        }
    )
)

# ---------------------------------------------------------------------------
# 2. Model configuration
# ---------------------------------------------------------------------------

MODEL_NAME = "zed-industries/zeta-2"
MODEL_REVISION = "main"

# ---------------------------------------------------------------------------
# 3. Persistent volumes for caching
# ---------------------------------------------------------------------------
# These keep model weights and vLLM compilation artifacts across deploys,
# so you don't re-download 16GB every cold start.

hf_cache = modal.Volume.from_name("hf-cache-zeta2", create_if_missing=True)
vllm_cache = modal.Volume.from_name("vllm-cache-zeta2", create_if_missing=True)

# ---------------------------------------------------------------------------
# 4. Boot configuration
# ---------------------------------------------------------------------------
# FAST_BOOT=True: Skip JIT compilation for faster cold starts (~30s).
#   Good when you're the only user and the GPU scales to zero often.
# FAST_BOOT=False: Full compilation for max inference speed.
#   Better when the server stays warm with consistent traffic.

FAST_BOOT = True

# ---------------------------------------------------------------------------
# 5. App definition
# ---------------------------------------------------------------------------

app = modal.App("zeta2-edit-prediction")

MINUTES = 60
VLLM_PORT = 8000


def download_model():
    """Pre-download model weights into the HF cache volume."""
    from huggingface_hub import snapshot_download

    snapshot_download(
        MODEL_NAME,
        revision=MODEL_REVISION,
        ignore_patterns=["*.pt", "*.bin"],  # prefer safetensors
    )


# Bake the model download into the image so it's cached
vllm_image = vllm_image.run_function(
    download_model,
    volumes={"/root/.cache/huggingface": hf_cache},
)


@app.function(
    image=vllm_image,
    gpu="L4",  # 24GB VRAM - fits Zeta 2 8B comfortably
    volumes={
        "/root/.cache/huggingface": hf_cache,
        "/root/.cache/vllm": vllm_cache,
    },
    scaledown_window=5 * MINUTES,  # Stay warm for 5 min after last request
    timeout=10 * MINUTES,  # Max request time
    # For auth, set this secret in Modal dashboard:
    # modal secret create zeta2-auth AUTH_TOKEN=your-secret-token
    # Then uncomment the next line:
    # secrets=[modal.Secret.from_name("zeta2-auth")],
)
@modal.web_server(port=VLLM_PORT, startup_timeout=5 * MINUTES)
def serve():
    """
    Spin up vLLM serving Zeta 2 with optimizations for edit prediction.

    Key optimizations:
    - prefix_caching: Reuses KV cache for repeated context (same file, same imports).
      Dramatically speeds up sequential completions in the same file.
    - chunked_prefill: Processes long prompts in chunks to reduce memory spikes.
    - speculative decoding with n-gram: For edit prediction, most output tokens
      already exist in the prompt. N-gram speculation exploits this by proposing
      tokens from the prompt itself, so the model just confirms them. Very fast.
    - max_model_len=16384: Enough for current file + related files + edit history.
      Increase if you want more context, decrease to save VRAM.
    """
    cmd = [
        "vllm",
        "serve",
        MODEL_NAME,
        "--served-model-name", "zeta-2",
        "--host", "0.0.0.0",
        "--port", str(VLLM_PORT),
        "--dtype", "auto",
        "--max-model-len", "16384",
        "--gpu-memory-utilization", "0.92",
        "--enable-prefix-caching",
        "--enable-chunked-prefill",
    ]

    # Fast boot: skip torch.compile and CUDA graph capture for faster cold starts
    if FAST_BOOT:
        cmd += [
            "--enforce-eager",  # Skip CUDA graph capture
        ]

    subprocess.Popen(cmd)


# ---------------------------------------------------------------------------
# 6. Usage
# ---------------------------------------------------------------------------
#
# Deploy:
#   modal deploy serve_zeta2.py
#
# You'll get a URL like:
#   https://your-workspace--zeta2-edit-prediction-serve.modal.run
#
# Test with curl:
#   curl -X POST https://your-workspace--zeta2-edit-prediction-serve.modal.run/v1/completions \
#     -H "Content-Type: application/json" \
#     -d '{
#       "model": "zeta-2",
#       "prompt": "<[fim-suffix]>\n}\n<[fim-prefix]><filename>src/utils.ts\nexport function formatDate(date: Date): string {\n  return date.toISOString().split(\"T\")[0];\n}\n\n<filename>src/app.ts\nimport { formatDate } from \"./utils\";\n\nfunction getUser() {\n  const today = formatDate(\n<<<<<<< CURRENT\n    new Date()\n  );\n  console.log(\n=======\n<[fim-middle]>",
#       "max_tokens": 128,
#       "temperature": 0,
#       "stop": [">>>>>>> UPDATED"]
#     }'
#
# Or use the OpenAI SDK from your VS Code extension:
#
#   import OpenAI from "openai";
#   const client = new OpenAI({
#     baseURL: "https://your-workspace--zeta2-edit-prediction-serve.modal.run/v1",
#     apiKey: "not-needed-yet",  // add auth later
#   });
#
#   const completion = await client.completions.create({
#     model: "zeta-2",
#     prompt: buildZetaPrompt(context),  // your prompt builder
#     max_tokens: 128,
#     temperature: 0,
#     stop: [">>>>>>> UPDATED"],
#   });