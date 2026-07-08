# CoFlow

CoFlow는 Codex를 위한 agent-native 미디어 캔버스입니다.

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

무한 tldraw 화이트보드, Codex skills, MCP tools를 연결해 시각적 컨텍스트를 가리키고, 원하는 변경을 설명하고, 새 이미지나 비디오를 생성한 뒤 로컬 에셋과 버전 계보를 함께 캔버스에 다시 넣을 수 있습니다.

## CoFlow란

CoFlow는 provider 입력 폼도, 가벼운 Canva 클론도, 정적인 이미지 보드도 아닙니다.

캔버스는 시각적 컨텍스트를 담는 작업면입니다:

- 원본 이미지와 비디오를 선택하거나 프레임으로 묶기;
- 화살표, 박스, 메모, 공간 주석 추가하기;
- Codex가 MCP를 통해 경계가 정해진 캔버스 컨텍스트 읽기;
- Codex native 이미지 기능 또는 외부 provider로 생성하기;
- 생성 결과를 tldraw native 이미지/비디오 객체로 다시 쓰기;
- 프롬프트, 모델/provider 메타데이터, 로컬 경로, 버전 계보 보존하기.

핵심 흐름:

```text
캔버스에서 미디어를 선택하거나 프레임으로 묶기
→ Codex에서 편집/생성 요청 작성
→ CoFlow skills가 bounded context 읽기
→ Codex가 적절한 생성 경로 선택
→ 생성된 미디어가 캔버스에 삽입됨
→ 버전 관계가 추적 가능하게 남음
```

## 현재 상태

CoFlow는 Phase 1 RC 상태이며 이미지/비디오 생성과 writeback 루프에 집중합니다.

현재 동작하는 것:

- tldraw 기반 무한 캔버스;
- native 이미지/비디오 asset writeback;
- prompt-only 이미지 생성에서 잘못된 lineage link를 만들지 않는 동작;
- 이미지/비디오 reference workflow boundary;
- Atlas Cloud 외부 이미지/비디오 모델 실행;
- provider/model onboarding 및 상태 도구;
- multi-page 캔버스 persistence;
- 로컬 `.coflow/` asset 및 metadata store;
- Codex plugin manifest, skills, MCP server.

아직 제공을 약속하지 않는 것:

- 완전한 3D 캔버스 preview/editing;
- hosted multi-user collaboration;
- 완성형 consumer SaaS UI.

## 저장소 구조

활성 plugin/runtime 위치:

```text
coflow/
```

중요 파일:

```text
coflow/.codex-plugin/plugin.json  # Codex plugin manifest
coflow/.mcp.json                  # MCP server config
coflow/mcp-server.mjs             # Codex-facing MCP tools
coflow/server.mjs                 # local canvas server
coflow/src/                       # tldraw canvas app
coflow/skills/                    # CoFlow Codex skills
coflow/lib/                       # provider/runtime helpers
coflow/tests/                     # regression tests
```

생성 에셋과 로컬 런타임 상태는 `.coflow/` 아래 저장되며 git에서 무시됩니다.

## Quick Start

```bash
cd coflow
npm install
npm run build
npm run serve
```

열기:

```text
http://127.0.0.1:5176/
```

plugin 개발에서는 local personal marketplace의 `~/plugins/coflow`가 `coflow`를 가리키게 한 뒤 설치합니다:

```bash
codex plugin add coflow@personal
```

로컬 plugin 버전을 다시 설치한 뒤에는 새 Codex thread를 시작하거나 Codex를 재시작해 새 skills와 MCP tools를 로드하세요.

## Provider 설정

기본 이미지 경로는 Codex built-in GPT Image 2를 사용하며 이미지 생성과 이미지 편집/reference 작업을 처리합니다.

기본 비디오 경로는 Atlas Cloud Seedance 2.0을 사용하며 text-to-video와 reference/video editing을 처리합니다.

다음 초대 링크로 Atlas Cloud API key를 만들 수 있습니다:

[Atlas Cloud API keys](https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG)

그런 다음 로컬 env 파일에 key를 추가합니다:

```bash
ATLASCLOUD_API_KEY=...
```

지원하는 env 파일 위치:

```text
.env.local
coflow/.env.local
```

API key를 commit하거나 채팅에 붙여넣지 마세요.

## Codex Skills

핵심 skills:

- `coflow-open`은 로컬 캔버스를 엽니다.
- `coflow-provider-setup`은 이미지/비디오 provider 기본값을 읽거나 변경합니다.
- `coflow-model-list`는 현재 설정된 모델 지원을 요약합니다.
- `coflow-image`는 캔버스 컨텍스트에서 이미지 생성과 이미지 편집을 처리합니다.
- `coflow-video`는 text-to-video와 reference/video revision workflow를 처리합니다.

시나리오 skills:

- `coflow-product-marketing`
- `coflow-social-repurpose`
- `coflow-video-ad-keyframes`
- `coflow-style-exploration`
- `coflow-3d`

## 개발 체크

`coflow/`에서 실행:

```bash
npm test
npm run build
```

plugin manifest validation:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py coflow
```

## 설계 원칙

- 캔버스는 시각적 컨텍스트와 writeback surface다.
- Codex는 의도 이해, skill routing, provider orchestration을 담당한다.
- tldraw native assets/shapes/bindings를 먼저 사용한다.
- prompt-only 생성은 가짜 lineage link를 만들면 안 된다.
- reference 기반 생성은 소스 관계를 보존해야 한다.
- provider setup은 포괄적 업로드 권한이 아니며, asset sharing은 task-scoped다.
- local-first storage는 생성 미디어와 메타데이터를 inspect 가능하게 해야 한다.

## License

MIT
