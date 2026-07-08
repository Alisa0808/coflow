---
name: coflow-open
description: Open the CoFlow local tldraw whiteboard in Codex. Use when the user asks to open the canvas, open canva, 打开白板, or start working on the media canvas.
---

# Open

Open the local CoFlow at:

```text
http://127.0.0.1:5176/
```

## Workflow

1. Fast path first: if `http://127.0.0.1:5176/` is already reachable, reuse it immediately.

   Do not inspect canvas content, provider onboarding, selection state, or page identity on the normal fast path. Opening the board should only confirm that the local service exists and then hand the URL to the Codex in-app browser.

2. If port `5176` is not reachable, start the local service from the installed plugin root.

   The plugin root is the directory that contains this plugin's `package.json`, `server.mjs`, and `skills/` folder. Do not use or show a developer checkout path.

   Run the service from that installed plugin root with `npm run serve`.

   If port `5176` is already in use, do not start a second server. Use the existing canvas URL.

3. When the skill is used inside Codex, open or focus the canvas URL in the Codex in-app browser by default.

   Do not use Puppeteer, the Chrome plugin, `open`, or any external system browser for the default Codex workflow. Those tools control an external browser and are not equivalent to the Codex in-app browser.

   If Codex in-app browser control is unavailable in the current session, keep the local service running and return the local URL as the fallback. Tell the user to open it in the Codex in-app browser instead of opening Chrome yourself.

4. Provider onboarding is deferred by default.

   Do not block opening the board on `canvas.get_provider_onboarding`. Read it only when:

   - the user asks about provider/model setup;
   - image/video generation is about to run and needs provider diagnostics;
   - a generation request fails due to provider credentials;
   - or the tool is already available and the check is effectively free.

   - `shouldPrompt` is an internal boolean returned by the onboarding tool. It means the user has not configured or skipped provider setup yet.
   - If `shouldPrompt` is true, show a short first-run setup prompt in the Codex conversation after opening the canvas. Do not expose the field name to the user.
   - Offer the three actions from the payload: "Keep defaults and set up Atlas Cloud", "Customize providers and models", or "Skip for now".
   - If setup is already `configured`, do not interrupt the user; just open the board.
   - If setup was `skipped`, do not nag on every open. Mention that provider setup can be rerun only when the user asks about provider/model settings or generation fails.

5. Do not seed example content automatically. The default board should be the user's saved local canvas or a blank board.

## User-facing behavior

After opening the board, tell the user they can:

- upload an image or video;
- add notes, boxes, or arrows;
- put a frame around the task;
- use the image or video skill in Codex;
- click `Send to Codex` on a frame to hand bounded context to Codex;
- use canvas Quick Edit on a selected single image for simple one-shot edits when that UI is available.

Do not expose implementation paths, developer checkout paths, plugin cache paths, or startup commands in normal user-facing replies. Only show the canvas URL. Mention local paths only when the user is explicitly debugging installation or server startup.

Only when provider onboarding is explicitly checked on first run, also tell the user:

- default image provider/model;
- default video provider/model;
- "Keep defaults and set up Atlas Cloud", "Customize providers and models", or "Skip for now".

## Guardrails

- This skill only opens the canvas.
- It does not call image/video providers.
- Opening the canvas is not permission to upload canvas assets to an external provider. External asset sharing is authorized only by a later CoFlow image/video generation task with bounded selected/frame/viewport context.
- It does not inspect or mutate canvas drawing state unless opening fails or the user asks.
- It should keep non-generation open overhead under 10 seconds when the service is already running.
- It may read provider onboarding state only when needed; onboarding is Codex-side setup, not canvas content.
