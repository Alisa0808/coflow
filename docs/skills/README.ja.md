# CoFlow Skill ガイド

言語：[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

このガイドは CoFlow の user-facing skills を説明します。実行時に Codex が読む正規の skill instructions は `coflow/skills/*/SKILL.md` にあります。

## 基本モデル

CoFlow skills はキャンバスを provider フォームにするものではありません。Codex が境界づけられた視覚コンテキストを読み、生成ルートを選び、結果をキャンバスに書き戻すためのものです。

CoFlow が向いているタスク：

- キャンバス上の選択メディアに依存する；
- frame と注釈に依存する；
- 現在見えているキャンバスコンテキストに依存する；
- バージョン関係と writeback が必要；
- ローカル生成ファイルとメタデータが必要。

## Core Skills

### `coflow-open`

ローカル CoFlow キャンバスを開きます。

使う場面：

- CoFlow ボードを開始または再開する；
- ローカルキャンバス URL が必要；
- Codex にホワイトボードの起動状態を確認させたい。

例：

```text
Open CoFlow.
Open the CoFlow canvas in the browser.
Check whether the CoFlow board is running.
```

### `coflow-provider-setup`

画像/動画 provider のデフォルト設定を表示または変更します。

使う場面：

- 現在の画像/動画モデルのデフォルトを確認する；
- 画像生成を Atlas Cloud に切り替える；
- Seedance や Kling などの動画モデルを切り替える；
- Atlas Cloud credential の不足を診断する。

例：

```text
Show my CoFlow provider settings.
Switch video generation to Seedance 2.0 Mini.
Use Atlas Cloud for image generation.
Check whether Atlas Cloud is connected.
```

Atlas Cloud API key link：

[Atlas Cloud API keys](https://www.atlascloud.ai/console/api-keys?utm_source=coflow&ref=F27PTG)

### `coflow-model-list`

CoFlow に設定されている provider/model catalog を要約します。

使う場面：

- CoFlow がローカルでサポートする画像/動画モデルを知りたい；
- Atlas Cloud の利用可能なモデルファミリーを簡潔に見たい；
- raw model id を入力せずにモデルを選びたい。

例：

```text
What image and video models does CoFlow support?
List the available CoFlow video models.
Which model should I use for reference-to-video?
```

### `coflow-image`

キャンバスコンテキストから画像を生成または編集します。

使う場面：

- prompt-only text-to-image をキャンバスへ戻す；
- 選択画像の修正版を作る；
- frame 内の元画像と注釈を使う；
- 出力をホワイトボードへ戻したい。

例：

```text
Generate a 9:16 poster and place it on the canvas.
Edit the selected image: make the background warmer.
Use this framed product image and create three ad variants.
```

重要な動作：

- prompt-only output は standalone media として挿入される；
- reference-based edits は追跡可能な version を作る；
- ユーザーが外部 provider を選ばない限り、画像デフォルトは Codex built-in GPT Image 2；
- 外部 provider への asset sharing はタスク単位。

### `coflow-video`

prompt、画像、動画、frame context から動画を生成または修正します。

使う場面：

- text-to-video；
- 選択画像から image-to-video；
- 選択動画の revision/regeneration；
- 動画出力をキャンバスへ戻す。

例：

```text
Create a 5-second vertical video from this product image.
Turn the selected frame into a cinematic video.
Regenerate this video with softer motion.
```

重要な動作：

- デフォルト動画 provider は Atlas Cloud Seedance 2.0；
- model-specific options は provider 実行前に検証される；
- writeback では出力サイズと aspect ratio を保持する。

## Scenario Skills

### `coflow-product-marketing`

選択素材から製品マーケティング画像や campaign variants を作ります。

向いている用途：

- product ad variants；
- ecommerce hero images；
- social campaign creatives；
- 複数のビジュアル方向の比較。

### `coflow-social-repurpose`

選択メディアをソーシャル用の aspect ratio に適応します。

向いている用途：

- 1:1 feed posts；
- 9:16 Stories、Reels、Shorts、TikTok；
- 16:9 YouTube または landscape placements；
- 同じ source concept を複数 format で保つ。

### `coflow-video-ad-keyframes`

動画広告の keyframes を計画または生成します。

向いている用途：

- storyboard direction；
- hook/middle/end structure；
- product reveal sequences；
- 動画生成前の広告設計。

### `coflow-style-exploration`

同じ source から複数の visual styles を探索します。

向いている用途：

- brand direction exploration；
- mood/style variants；
- 選択前の visual treatment 比較。

### `coflow-3d`

初期 3D workflow boundary を定義します。

向いている用途：

- 将来の 3D 生成に向けた references 収集；
- キャンバスコンテキストから 3D intent を記述；
- 3D generation workflow の準備。

現在の project は full 3D canvas preview/editing を提供しているとは主張していません。

## Writeback Rules

CoFlow-contextual task では、生成は `canvas.insert_media` によってキャンバスへ書き戻されるまで完了ではありません。

最小 generated-media fields：

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

生成に成功しても書き戻し可能な media path または URL がない場合、完了扱いにせず問題を報告します。

## Safety Boundary

キャンバスを開くことは、asset upload の包括的な許可ではありません。

外部 provider call では、現在のタスクに必要な selected/framed/visible bounded assets だけを使用できます。無関係な board assets、local config files、API keys、secrets をアップロードしないでください。
