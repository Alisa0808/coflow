export type MediaType = 'image' | 'video' | 'frame' | 'model3d'
export type ProviderMode = 'auto' | 'codex' | 'atlas' | 'custom'
export type SceneMode =
  | 'none'
  | 'product-marketing-set'
  | 'social-repurpose'
  | 'video-ad-keyframes'
  | 'style-exploration'

export type RequestStatus = 'queued' | 'claimed' | 'processing' | 'completed' | 'failed'

export type Rect = {
  x: number
  y: number
  w: number
  h: number
}

export type Annotation = {
  id: string
  text: string
  targetAssetId: string
  createdAt: string
}

export type MediaAsset = {
  assetId: string
  type: MediaType
  localPath: string
  publicUrl: string
  thumbnailPath?: string
  thumbnailUrl?: string
  fileName: string
  mimeType: string
  width?: number
  height?: number
  durationMs?: number
  timestampMs?: number
  parentAssetId?: string
  parentVersionId?: string
  sourceVideoAssetId?: string
  references: string[]
  annotations: Annotation[]
  prompt?: string
  provider?: string
  model?: string
  params: Record<string, unknown>
  skillName?: string
  jobId?: string
  version: number
  createdAt: string
  position: Rect
}

export type CanvasSelection = {
  selectedAssetIds: string[]
  assets: MediaAsset[]
  annotations: Annotation[]
  providerPreference: ProviderMode
  sceneMode: SceneMode
  updatedAt: string
}

export type CanvasRequest = {
  requestId: string
  requestType:
    | 'image.edit'
    | 'image.generate'
    | 'video.frame-reference'
    | 'scene.product-marketing-set'
    | 'scene.social-repurpose'
    | 'scene.video-ad-keyframes'
    | 'scene.style-exploration'
  status: RequestStatus
  selectedAssetIds: string[]
  instruction: string
  annotations: Annotation[]
  providerPreference: ProviderMode
  sceneMode: SceneMode
  preset: ScenePreset
  createdAt: string
  updatedAt: string
  claimedAt?: string
  result?: Record<string, unknown>
  error?: string
}

export type ScenePreset = {
  id: SceneMode
  label: string
  description: string
  outputCount: number
  outputs: Array<{
    id: string
    label: string
    aspectRatio?: string
    purpose: string
  }>
}

export type CanvasState = {
  projectName: 'Codex Media Canvas'
  version: 1
  assets: MediaAsset[]
  selection: CanvasSelection
  requests: CanvasRequest[]
  providerMode: ProviderMode
  sceneMode: SceneMode
  lastUsedModel?: string
}

export const sceneModeLabels: Record<SceneMode, string> = {
  none: 'No scene preset',
  'product-marketing-set': 'Product Marketing Set',
  'social-repurpose': 'Social Repurpose',
  'video-ad-keyframes': 'Video Ad Keyframes',
  'style-exploration': 'Style Exploration',
}

export const providerModeLabels: Record<ProviderMode, string> = {
  auto: 'Auto',
  codex: 'Codex native',
  atlas: 'Atlas Cloud',
  custom: 'Custom provider',
}

export const providerSetupMessages: Record<ProviderMode, string> = {
  auto: 'Codex chooses the best available path. Configure provider details in Codex when needed.',
  codex: 'Codex native generation can run without Atlas for zero-config demos.',
  atlas: 'Atlas Cloud is optional but recommended for advanced image/video generation. Configure ATLASCLOUD_API_KEY and Atlas Skill/MCP/CLI in Codex.',
  custom: 'Custom providers must expose a Skill, MCP server, or CLI that returns a local output path and metadata.',
}

export const scenePresets: Record<SceneMode, ScenePreset> = {
  none: {
    id: 'none',
    label: 'No scene preset',
    description: 'Use the selected asset and annotations as direct Codex context.',
    outputCount: 1,
    outputs: [{ id: 'new-version', label: 'New version', purpose: 'Revise the selected asset.' }],
  },
  'product-marketing-set': {
    id: 'product-marketing-set',
    label: 'Product Marketing Set',
    description: 'Generate a coherent set of product marketing/ad/social visuals.',
    outputCount: 4,
    outputs: [
      { id: 'hero', label: 'Hero product visual', aspectRatio: '1:1', purpose: 'Clean product-focused hero image.' },
      { id: 'lifestyle', label: 'Lifestyle/social visual', aspectRatio: '3:4', purpose: 'Social-friendly lifestyle version.' },
      { id: 'benefit-ad', label: 'Benefit-led ad', aspectRatio: '4:5', purpose: 'Ad visual emphasizing a core benefit.' },
      { id: 'launch', label: 'Launch/promo variant', aspectRatio: '16:9', purpose: 'Horizontal campaign or banner variant.' },
    ],
  },
  'social-repurpose': {
    id: 'social-repurpose',
    label: 'Social Repurpose',
    description: 'Adapt one source asset into platform-specific social versions.',
    outputCount: 5,
    outputs: [
      { id: 'xiaohongshu', label: 'Xiaohongshu cover', aspectRatio: '3:4', purpose: 'Portrait cover for Xiaohongshu.' },
      { id: 'instagram-post', label: 'Instagram post', aspectRatio: '1:1', purpose: 'Square or portrait Instagram post.' },
      { id: 'story', label: 'Story/Reels', aspectRatio: '9:16', purpose: 'Vertical story/reels version.' },
      { id: 'youtube-thumbnail', label: 'YouTube thumbnail', aspectRatio: '16:9', purpose: 'Horizontal thumbnail.' },
      { id: 'horizontal-ad', label: 'Horizontal ad', aspectRatio: '16:9', purpose: 'Ad/banner version.' },
    ],
  },
  'video-ad-keyframes': {
    id: 'video-ad-keyframes',
    label: 'Video Ad Keyframes',
    description: 'Create storyboard frames, keyframes, or prompt packages for video ads.',
    outputCount: 4,
    outputs: [
      { id: 'opening', label: 'Opening hook', aspectRatio: '16:9', purpose: 'First-frame hook or scene opener.' },
      { id: 'product-reveal', label: 'Product reveal', aspectRatio: '16:9', purpose: 'Clear product reveal keyframe.' },
      { id: 'benefit-shot', label: 'Benefit shot', aspectRatio: '16:9', purpose: 'Show benefit or use case.' },
      { id: 'cta-frame', label: 'CTA frame', aspectRatio: '16:9', purpose: 'Final call-to-action frame.' },
    ],
  },
  'style-exploration': {
    id: 'style-exploration',
    label: 'Style Exploration',
    description: 'Explore multiple visual directions from selected references.',
    outputCount: 4,
    outputs: [
      { id: 'clean', label: 'Clean/minimal direction', purpose: 'Minimal and polished direction.' },
      { id: 'premium', label: 'Premium/editorial direction', purpose: 'High-end editorial treatment.' },
      { id: 'bold', label: 'Bold/high-contrast direction', purpose: 'High-impact social/ad style.' },
      { id: 'cinematic', label: 'Cinematic direction', purpose: 'Narrative cinematic treatment.' },
    ],
  },
}

export function getRequestTypeForScene(sceneMode: SceneMode, hasVideoFrame: boolean) {
  if (sceneMode === 'product-marketing-set') return 'scene.product-marketing-set' as const
  if (sceneMode === 'social-repurpose') return 'scene.social-repurpose' as const
  if (sceneMode === 'video-ad-keyframes') return 'scene.video-ad-keyframes' as const
  if (sceneMode === 'style-exploration') return 'scene.style-exploration' as const
  return hasVideoFrame ? ('video.frame-reference' as const) : ('image.edit' as const)
}
