# CoFlow Skill 가이드

언어: [English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

이 가이드는 CoFlow의 user-facing skills를 설명합니다. Codex가 실제로 읽는 실행용 skill instructions는 `coflow/skills/*/SKILL.md`에 있으며, 그 파일들이 canonical runtime instructions입니다.

## 핵심 모델

CoFlow skills는 캔버스를 provider form으로 바꾸지 않습니다. Codex가 bounded visual context를 읽고, 생성 경로를 선택하고, 결과를 캔버스에 writeback하도록 돕습니다.

CoFlow를 쓰기 좋은 경우:

- 작업이 캔버스의 선택 미디어에 의존할 때;
- frame과 annotation에 의존할 때;
- 현재 보이는 캔버스 컨텍스트에 의존할 때;
- version lineage와 writeback이 필요할 때;
- 로컬 generated-media files와 metadata가 필요할 때.

## Core Skills

### `coflow-open`

로컬 CoFlow 캔버스를 엽니다.

사용 시점:

- CoFlow board를 시작하거나 이어서 작업할 때;
- 로컬 캔버스 URL이 필요할 때;
- Codex가 화이트보드 실행 상태를 확인해야 할 때.

예시:

```text
Open CoFlow.
Open the CoFlow canvas in the browser.
Check whether the CoFlow board is running.
```

### `coflow-provider-setup`

이미지/비디오 provider 기본값을 보거나 변경합니다.

사용 시점:

- 현재 이미지/비디오 모델 기본값을 확인할 때;
- 이미지 생성을 Atlas Cloud로 바꿀 때;
- Seedance나 Kling 같은 비디오 모델을 바꿀 때;
- Atlas Cloud credential 누락을 진단할 때.

예시:

```text
Show my CoFlow provider settings.
Switch video generation to Seedance 2.0 Mini.
Use Atlas Cloud for image generation.
Check whether Atlas Cloud is connected.
```

Atlas Cloud API key 링크:

[Atlas Cloud API keys](https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG)

### `coflow-model-list`

CoFlow에 설정된 provider/model catalog를 요약합니다.

사용 시점:

- CoFlow가 로컬에서 지원하는 이미지/비디오 모델을 알고 싶을 때;
- 사용 가능한 Atlas Cloud model families를 간단히 보고 싶을 때;
- raw model id를 직접 쓰지 않고 모델을 고르고 싶을 때.

예시:

```text
What image and video models does CoFlow support?
List the available CoFlow video models.
Which model should I use for reference-to-video?
```

### `coflow-image`

캔버스 컨텍스트에서 이미지를 생성하거나 편집합니다.

사용 시점:

- prompt-only text-to-image 결과를 캔버스에 넣을 때;
- 선택한 이미지의 수정 버전을 만들 때;
- frame 안의 source images와 annotations를 사용할 때;
- output을 whiteboard에 다시 넣어야 할 때.

예시:

```text
Generate a 9:16 poster and place it on the canvas.
Edit the selected image: make the background warmer.
Use this framed product image and create three ad variants.
```

중요 동작:

- prompt-only output은 standalone media로 삽입됩니다;
- reference-based edits는 traceable versions를 만들어야 합니다;
- 사용자가 외부 provider를 선택하지 않으면 이미지 기본값은 Codex built-in GPT Image 2입니다;
- 외부 provider asset sharing은 task-scoped입니다.

### `coflow-video`

prompt, image, video, framed context에서 비디오를 생성하거나 수정합니다.

사용 시점:

- text-to-video;
- 선택 이미지로 image-to-video;
- 선택 비디오 revision/regeneration;
- 비디오 output을 캔버스에 다시 넣을 때.

예시:

```text
Create a 5-second vertical video from this product image.
Turn the selected frame into a cinematic video.
Regenerate this video with softer motion.
```

중요 동작:

- 기본 비디오 provider는 Atlas Cloud Seedance 2.0입니다;
- model-specific options는 provider 실행 전에 검증됩니다;
- writeback 시 output dimensions와 aspect ratio를 유지해야 합니다.

## Scenario Skills

시나리오별 skills는 아직 plugin에 포함하지 않습니다. 현재 CoFlow는 canvas, image, video, provider setup, model list 핵심 skills만 노출합니다.

## Writeback Rules

CoFlow-contextual tasks에서 generation은 `canvas.insert_media`로 캔버스에 writeback되기 전까지 완료가 아닙니다.

최소 generated-media fields:

```json
{
  "mediaType": "image | video",
  "localPath": "...",
  "absolutePath": "...",
  "src": "...",
  "prompt": "...",
  "provider": "...",
  "model": "..."
}
```

생성은 성공했지만 writable media path 또는 URL이 없다면, 완료된 척하지 말고 문제를 보고해야 합니다.

## Safety Boundary

캔버스를 여는 것은 asset upload에 대한 blanket permission이 아닙니다.

외부 provider 호출은 현재 task에 필요한 selected, framed, visible bounded assets만 사용할 수 있습니다. 관련 없는 board assets, local config files, API keys, secrets를 업로드하지 마세요.
