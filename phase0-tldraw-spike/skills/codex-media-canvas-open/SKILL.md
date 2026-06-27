---
name: codex-media-canvas-open
description: Open the Codex Media Canvas local tldraw whiteboard in Codex. Use when the user asks to open the canvas, open canva, 打开白板, or start working on the media canvas.
---

# Codex Media Canvas Open

Open the local Codex Media Canvas at:

```text
http://127.0.0.1:5176/
```

## Workflow

1. Ensure the local service is running from the project:

   ```bash
   cd /Users/qiutian/Projects/apps/coding-agent-canva/phase0-tldraw-spike
   npm run serve
   ```

   If port `5176` is already in use, do not start a second server. Use the existing canvas URL.

2. Open or focus the canvas URL in the Codex in-app browser.

3. Do not seed example content automatically. The default board should be the user's saved local canvas or a blank board.

## User-facing behavior

After opening the board, tell the user they can:

- upload an image or video;
- add notes, boxes, or arrows;
- put a frame around the task;
- use the image or video skill in Codex;
- or click `Send to Codex` / `Generate version` when the right skill session is active.

## Guardrails

- This skill only opens the canvas.
- It does not call image/video providers.
- It does not inspect or mutate canvas state unless opening fails or the user asks.
