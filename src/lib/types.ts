export type Aspect = "16:9" | "9:16" | "1:1";
export type ProductionMode = "manual" | "assisted" | "automatic";

export interface VisualStyle {
  id: string;
  user_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  is_custom: boolean;
  config: {
    lighting?: string;
    photography?: string;
    palette?: string[];
    textures?: string;
    environments?: string;
    cinematic_language?: string;
    prompt_modifier?: string;
  };
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  original_idea: string;
  genre: string | null;
  visual_style_id: string | null;
  format: string;
  aspect_ratio: Aspect;
  target_duration_seconds: number;
  language: string;
  character_count: number | null;
  production_mode: ProductionMode;
  current_step: string;
  step_status: Record<string, "pending" | "approved">;
  status: "draft" | "in_progress" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Character {
  id: string;
  name: string;
  apparent_age: string | null;
  physical_traits: string | null;
  clothing: string | null;
  personality: string | null;
  expressions: string | null;
  voice: string | null;
  permanent_visual_traits: string | null;
  story_role: string | null;
  visual_prompt_en: string | null;
  source: "manual" | "extracted" | "generated" | "uploaded";
  status: "draft" | "approved";
  created_at: string;
  updated_at: string;
}

export interface CharacterReference {
  id: string;
  character_id: string;
  kind: "main" | "sheet" | "upload" | "expression" | "pose";
  storage_bucket: string;
  storage_path: string;
  is_primary: boolean;
  created_at: string;
}

export interface Job {
  id: string;
  project_id: string | null;
  kind: "text" | "image" | "video";
  purpose: string;
  model: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  attempts: number;
  max_attempts: number;
  target: Record<string, any>;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface HistoryRow {
  id: string;
  project_id: string | null;
  kind: "text" | "image" | "video";
  model: string;
  status: "succeeded" | "failed" | "cancelled";
  prompt_tokens: number | null;
  completion_tokens: number | null;
  images_count: number | null;
  video_seconds: number | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface MediaItem {
  id: string;
  project_id: string | null;
  kind: "character" | "image" | "reference" | "storyboard" | "video" | "audio" | "subtitle";
  name: string;
  source: "generated" | "upload";
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

export interface AiModel {
  id: string;
  kind: "text" | "image" | "video";
  model_id: string;
  label: string;
  enabled: boolean;
  verified: boolean;
}

export interface AgnesStatus {
  configured: boolean;
  key_last4: string | null;
  last_verified_at: string | null;
  rate_limits: { text: number; image: number; video: number };
  daily_video_seconds_limit: number;
}

// Etapas do fluxo do projeto (seção 16 do briefing). Todas existem como abas do projeto.
export const STEPS = [
  { key: "idea", label: "Ideia" },
  { key: "style", label: "Estilo" },
  { key: "characters", label: "Personagens" },
  { key: "script", label: "Roteiro" },
  { key: "storyboard", label: "Storyboard" },
  { key: "video", label: "Vídeos" },
  { key: "edit", label: "Montagem" },
  { key: "export", label: "Exportar" },
] as const;

export interface Script {
  id: string; project_id: string; version: number; title: string | null; logline: string | null;
  content: string; status: "draft" | "approved"; created_at: string;
}
export interface Sequence {
  id: string; project_id: string; position: number; title: string; summary: string | null; estimated_duration_seconds: number | null;
}
export type Approval = "pending" | "approved" | "rejected";
export interface Scene {
  id: string; project_id: string; sequence_id: string | null; position: number; title: string; description: string | null;
  location: string | null; character_ids: string[]; action: string | null; emotion: string | null; lighting: string | null;
  environment: string | null; estimated_duration_seconds: number | null; dialogue: string | null; approval_status: Approval;
}
export interface Shot {
  id: string; project_id: string; scene_id: string; position: number; shot_type: string | null; visual_prompt: string | null;
  character_motion: string | null; camera_movement: string | null; framing: string | null; lighting: string | null;
  environment: string | null; duration_seconds: number | null; character_ids: string[]; dialogue: string | null;
}
export interface StoryboardImage { id: string; scene_id: string; storage_path: string | null; created_at: string }
export interface VideoGen {
  id: string; shot_id: string | null; version: number; prompt: string; model: string; storage_path: string | null;
  is_selected: boolean; params: { width?: number; height?: number; num_frames?: number; frame_rate?: number }; created_at: string;
}
export interface AudioAsset {
  id: string; kind: "narration" | "dialogue" | "music" | "sfx" | "subtitle"; name: string; text_content: string | null;
  storage_path: string | null; duration_seconds: number | null; created_at: string;
}
export interface AiModelFull extends AiModel { capabilities: any }

export const SHOT_TYPES = [
  "Extreme Wide Shot", "Wide Shot", "Medium Shot", "Medium Close-up", "Close-up", "Extreme Close-up", "Over the Shoulder",
  "POV", "Low Angle", "High Angle", "Tracking Shot", "Dolly Shot", "Crane Shot",
];

export interface TimelineClip { id: string; shot_id: string; video_id: string; in: number; out: number; transition: "none" | "fade" }
export interface TimelineAudio { id: string; asset_id: string; start: number; volume: number }
export interface Timeline { clips: TimelineClip[]; audio: TimelineAudio[]; subtitles: boolean }
