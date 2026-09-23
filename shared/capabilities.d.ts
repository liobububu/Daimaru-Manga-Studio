export type DetectedCapability =
  | 'text_generation'
  | 'image_generation'
  | 'image_edit'
  | 'video_generation'
  | 'audio_generation'
  | 'audio_recognition'
  | 'multimodal';

export interface ModelCapabilityMetadata {
  id?: string;
  capabilities?: unknown;
  modalities?: unknown;
  input_modalities?: unknown;
  output_modalities?: unknown;
  input?: unknown;
  output?: unknown;
  input_types?: unknown;
  output_types?: unknown;
  [key: string]: unknown;
}

export function detectCapabilities(modelId: string): DetectedCapability[];
export function detectCapabilitiesFromModel(model: ModelCapabilityMetadata): DetectedCapability[];
export function diagnoseCapabilitiesFromModel(model: ModelCapabilityMetadata): {
  capabilities: DetectedCapability[];
  source: 'capabilities' | 'input_output' | 'modalities' | 'name_fallback';
  presentFields: string[];
};
