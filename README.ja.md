# CoFlow

CoFlow は Codex 向けの agent-native メディアキャンバスです。

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

無限 tldraw ホワイトボード、Codex skills、MCP tools をつなぎ、視覚コンテキストを指し示して変更内容を伝え、新しい画像や動画を生成し、ローカル資産とバージョン履歴つきでキャンバスへ戻せます。

## Design Idea

CoFlow の出発点はシンプルです。開発者が使える最も強力な Agent のひとつである Codex を、無限ホワイトボードキャンバスと組み合わせます。

Codex は harness を担当します。境界づけられた視覚コンテキストを読み、prompt を組み立て、適切な model/provider route を選び、ローカル asset を作り、lineage つきで結果を書き戻します。キャンバスは創作の発散的な自由を残します。reference、注釈、別案、アイデアの分岐を空間的に扱え、すべてを form に押し込む必要はありません。

## CoFlow とは

CoFlow は provider 入力フォームでも、軽量 Canva クローンでも、静的な画像ボードでもありません。

キャンバスは視覚コンテキストのための作業面です：

- 元画像や動画を選択、またはフレームで囲む；
- 矢印、ボックス、メモ、空間的な注釈を追加する；
- Codex が MCP 経由で境界づけられたキャンバスコンテキストを読む；
- Codex ネイティブ画像機能または外部 provider で生成する；
- 生成結果を tldraw ネイティブの画像/動画オブジェクトとして戻す；
- プロンプト、モデル/provider メタデータ、ローカルパス、バージョン関係を保持する。

基本フロー：

```text
キャンバス上でメディアを選択またはフレーム化
→ Codex で編集/生成リクエストを書く
→ CoFlow skills が境界づけられたコンテキストを読む
→ Codex が適切な生成ルートを選ぶ
→ 生成メディアがキャンバスに挿入される
→ バージョン関係が追跡可能なまま残る
```

## 現在の状態

CoFlow は Phase 1 RC で、画像/動画の生成と書き戻しループに注力しています。

現在利用できるもの：

- tldraw ベースの無限キャンバス；
- ネイティブ画像/動画アセットの書き戻し；
- prompt-only 画像生成で不要な lineage link を作らない動作；
- 画像/動画 reference ワークフローの境界；
- Atlas Cloud による外部画像/動画モデル実行；
- provider/model onboarding とステータスツール；
- 複数 page のキャンバス永続化；
- ローカル `.coflow/` アセットとメタデータ保存；
- Codex plugin manifest、skills、MCP server。

まだ提供を約束していないもの：

- 完全な 3D キャンバスプレビュー/編集；
- ホスト型のマルチユーザー共同編集；
- 完成された一般向け SaaS UI。

## リポジトリ構成

アクティブな plugin/runtime：

```text
coflow/
```

重要ファイル：

```text
coflow/.codex-plugin/plugin.json  # Codex plugin manifest
coflow/.mcp.json                  # MCP server config
coflow/mcp-server.mjs             # Codex 向け MCP tools
coflow/server.mjs                 # ローカルキャンバスサーバー
coflow/src/                       # tldraw canvas app
coflow/skills/                    # CoFlow Codex skills
coflow/lib/                       # provider/runtime helpers
coflow/tests/                     # regression tests
```

生成アセットとローカル実行状態は現在の workspace の `.coflow/` に保存され、git では無視されます。

## Quick Start

```bash
cd coflow
npm install
npm run build
npm run serve
```

開く URL：

```text
http://127.0.0.1:5176/
```

plugin 開発では、local personal marketplace の `~/plugins/coflow` を `coflow` に向けてからインストールします：

```bash
codex plugin add coflow@personal
```

ローカル plugin を再インストールした後は、新しい Codex thread を開始するか Codex を再起動して、新しい skills と MCP tools を読み込ませてください。

## Provider 設定

デフォルトの画像ルートは Codex built-in GPT Image 2 を使用し、画像生成と画像編集/reference を扱います。

デフォルトの動画ルートは Atlas Cloud Seedance 2.0 を使用し、text-to-video と reference/video editing を扱います。

Atlas Cloud API key は次の招待リンクから作成できます：

[Atlas Cloud API keys](https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG)

その後、ローカル env ファイルに key を追加します：

```bash
ATLASCLOUD_API_KEY=...
```

対応する env ファイル：

```text
.env.local
coflow/.env.local
```

API key を commit したり、チャットに貼り付けたりしないでください。

## Supported Models

CoFlow はユーザー向け docs と skills では読みやすい公式モデル名を使います。内部 provider model id は runtime config と diagnostics にだけ残します。

デフォルト：

- 画像生成/編集：Codex built-in GPT Image 2
- 動画生成/編集：Atlas Cloud Seedance 2.0

Atlas Cloud 画像モデル：

- GPT Image 2
- Nano Banana 2
- Nano Banana 2 Lite
- Nano Banana Pro
- Seedream 5.0 Pro
- Seedream 5.0 Lite
- Seedream 4.5
- Wan 2.7
- Grok Imagine Image
- Qwen Image 2.0

Atlas Cloud 動画モデル：

- Seedance 2.0
- Seedance 2.0 Mini
- Kling V3.0 Turbo / Standard / Pro / 4K
- Kling O3 Standard / Pro / 4K
- Wan 2.7
- HappyHorse 1.1
- Grok Imagine Video
- Grok Imagine Video v1.5

## Codex Skills

主要 skills：

- `coflow-open` はローカルキャンバスを開きます。
- `coflow-provider-setup` は画像/動画 provider のデフォルト設定を表示または変更します。
- `coflow-model-list` は現在設定されたモデルサポートを要約します。
- `coflow-image` はキャンバスコンテキストから画像生成と画像編集を行います。
- `coflow-video` は text-to-video と reference/video revision を扱います。

## 開発チェック

`coflow/` で実行：

```bash
npm test
npm run build
```

plugin manifest validation：

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py coflow
```

## 設計原則

- キャンバスは視覚コンテキストと書き戻し面である。
- Codex が意図理解、skill routing、provider orchestration を担当する。
- tldraw ネイティブ assets/shapes/bindings を優先する。
- prompt-only 生成では偽の lineage link を作らない。
- reference 生成ではソース関係を保持する。
- provider setup は包括的なアップロード許可ではなく、素材共有はタスク単位。
- local-first storage により生成メディアとメタデータを検査可能にする。

## License

MIT
