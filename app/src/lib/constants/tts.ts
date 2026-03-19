import {
  LANGUAGE_OPTIONS,
  type LanguageCode,
  type TranscriptionLanguageCode,
} from '@/lib/constants/languages';

export type TTSEngine = 'qwen' | 'luxtts' | 'chatterbox' | 'chatterbox_turbo';
export type TTSModelSize = '1.7B' | '0.6B' | 'default';
export type QwenModelSize = Extract<TTSModelSize, '1.7B' | '0.6B'>;
export type WhisperModelSize = 'base' | 'small' | 'medium' | 'large' | 'turbo';
export type GenerationSourceType = 'ai' | 'recording';

export interface TtsEngineOption {
  value: TTSEngine;
  label: string;
  description: string;
}

export interface TtsModelOption {
  value: TTSModelSize;
  label: string;
  modelName: string;
}

export interface GenerationModelOption {
  modelName: string;
  label: string;
  displayName: string;
  description: string;
  engine: TTSEngine;
  modelSize: TTSModelSize;
}

export interface DownloadableModelOption {
  modelName: string;
  displayName: string;
  engine: TTSEngine | 'whisper';
  modelSize: TTSModelSize | WhisperModelSize;
}

export const TTS_ENGINE_OPTIONS: TtsEngineOption[] = [
  {
    value: 'qwen',
    label: 'Qwen TTS',
    description: 'Best overall cloning quality with instruct support.',
  },
  {
    value: 'luxtts',
    label: 'LuxTTS',
    description: 'Fast, lightweight English voice cloning.',
  },
  {
    value: 'chatterbox',
    label: 'Chatterbox TTS',
    description: 'Multilingual expressive model.',
  },
  {
    value: 'chatterbox_turbo',
    label: 'Chatterbox Turbo',
    description: 'Faster English model with paralinguistic tags.',
  },
];

const ENGINE_DESCRIPTION_BY_VALUE = Object.fromEntries(
  TTS_ENGINE_OPTIONS.map((option) => [option.value, option.description]),
) as Record<TTSEngine, string>;

export const TTS_MODEL_OPTIONS: Record<TTSEngine, TtsModelOption[]> = {
  qwen: [
    {
      value: '1.7B',
      label: 'Qwen TTS 1.7B (Higher Quality)',
      modelName: 'qwen-tts-1.7B',
    },
    {
      value: '0.6B',
      label: 'Qwen TTS 0.6B (Faster)',
      modelName: 'qwen-tts-0.6B',
    },
  ],
  luxtts: [
    {
      value: 'default',
      label: 'LuxTTS',
      modelName: 'luxtts',
    },
  ],
  chatterbox: [
    {
      value: 'default',
      label: 'Chatterbox TTS',
      modelName: 'chatterbox-tts',
    },
  ],
  chatterbox_turbo: [
    {
      value: 'default',
      label: 'Chatterbox Turbo',
      modelName: 'chatterbox-turbo',
    },
  ],
};

export const GENERATION_MODEL_OPTIONS: GenerationModelOption[] = [
  {
    modelName: 'qwen-tts-1.7B',
    label: 'Qwen TTS 1.7B (Higher Quality)',
    displayName: 'Qwen TTS 1.7B',
    description: ENGINE_DESCRIPTION_BY_VALUE.qwen,
    engine: 'qwen',
    modelSize: '1.7B',
  },
  {
    modelName: 'qwen-tts-0.6B',
    label: 'Qwen TTS 0.6B (Faster)',
    displayName: 'Qwen TTS 0.6B',
    description: ENGINE_DESCRIPTION_BY_VALUE.qwen,
    engine: 'qwen',
    modelSize: '0.6B',
  },
  {
    modelName: 'luxtts',
    label: 'LuxTTS',
    displayName: 'LuxTTS (Fast, CPU-friendly)',
    description: ENGINE_DESCRIPTION_BY_VALUE.luxtts,
    engine: 'luxtts',
    modelSize: 'default',
  },
  {
    modelName: 'chatterbox-tts',
    label: 'Chatterbox TTS',
    displayName: 'Chatterbox TTS (Multilingual)',
    description: ENGINE_DESCRIPTION_BY_VALUE.chatterbox,
    engine: 'chatterbox',
    modelSize: 'default',
  },
  {
    modelName: 'chatterbox-turbo',
    label: 'Chatterbox Turbo',
    displayName: 'Chatterbox Turbo (English, Tags)',
    description: ENGINE_DESCRIPTION_BY_VALUE.chatterbox_turbo,
    engine: 'chatterbox_turbo',
    modelSize: 'default',
  },
];

export const DOWNLOADABLE_MODELS: DownloadableModelOption[] = [
  ...GENERATION_MODEL_OPTIONS.map((model) => ({
    modelName: model.modelName,
    displayName: model.displayName,
    engine: model.engine,
    modelSize: model.modelSize,
  })),
  {
    modelName: 'whisper-base',
    displayName: 'Whisper Base',
    engine: 'whisper',
    modelSize: 'base',
  },
  {
    modelName: 'whisper-small',
    displayName: 'Whisper Small',
    engine: 'whisper',
    modelSize: 'small',
  },
  {
    modelName: 'whisper-medium',
    displayName: 'Whisper Medium',
    engine: 'whisper',
    modelSize: 'medium',
  },
  {
    modelName: 'whisper-large',
    displayName: 'Whisper Large',
    engine: 'whisper',
    modelSize: 'large',
  },
  {
    modelName: 'whisper-turbo',
    displayName: 'Whisper Turbo',
    engine: 'whisper',
    modelSize: 'turbo',
  },
];

export const MODEL_DISPLAY_NAMES = Object.fromEntries(
  DOWNLOADABLE_MODELS.map((model) => [model.modelName, model.displayName]),
) as Record<string, string>;

const ENGINE_LANGUAGE_CODES: Record<TTSEngine, LanguageCode[]> = {
  qwen: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
  luxtts: ['en'],
  chatterbox: [
    'zh',
    'en',
    'ja',
    'ko',
    'de',
    'fr',
    'ru',
    'pt',
    'es',
    'it',
    'he',
    'ar',
    'da',
    'el',
    'fi',
    'hi',
    'ms',
    'nl',
    'no',
    'pl',
    'sv',
    'sw',
    'tr',
  ],
  chatterbox_turbo: ['en'],
};

export function engineSupportsInstruct(engine: TTSEngine): boolean {
  return engine === 'qwen';
}

export function engineUsesQwenModelSizes(engine: TTSEngine): boolean {
  return engine === 'qwen';
}

export function getLanguageOptionsForEngine(engine: TTSEngine) {
  const allowed = new Set(ENGINE_LANGUAGE_CODES[engine]);
  return LANGUAGE_OPTIONS.filter((option) => allowed.has(option.value));
}

export function getGenerationModelOptions(language?: string | null): GenerationModelOption[] {
  if (!language) {
    return GENERATION_MODEL_OPTIONS;
  }
  return GENERATION_MODEL_OPTIONS.filter((option) =>
    isLanguageSupportedByEngine(option.engine, language),
  );
}

export function getDefaultLanguageForEngine(
  engine: TTSEngine,
  preferred?: string | null,
): LanguageCode {
  const allowed = ENGINE_LANGUAGE_CODES[engine];
  if (preferred && allowed.includes(preferred as LanguageCode)) {
    return preferred as LanguageCode;
  }
  return allowed[0] ?? 'en';
}

export function getModelNameForSelection(
  engine: TTSEngine,
  modelSize?: TTSModelSize | null,
): string {
  const effectiveModelSize = getEffectiveModelSize(engine, modelSize);
  const option = GENERATION_MODEL_OPTIONS.find(
    (item) => item.engine === engine && item.modelSize === effectiveModelSize,
  );
  return option?.modelName ?? GENERATION_MODEL_OPTIONS[0].modelName;
}

export function getModelDisplayNameForSelection(
  engine: TTSEngine,
  modelSize?: TTSModelSize | null,
): string {
  const modelName = getModelNameForSelection(engine, modelSize);
  return MODEL_DISPLAY_NAMES[modelName] ?? modelName;
}

export function getGenerationAudioLabel(options: {
  engine?: string | null;
  modelSize?: string | null;
  sourceType?: string | null;
}): string {
  if (options.sourceType === 'recording') {
    return 'Recorded';
  }

  const engine = options.engine as TTSEngine | undefined;
  const modelSize = options.modelSize as TTSModelSize | undefined;

  if (engine === 'qwen') {
    return modelSize === '0.6B' ? 'Qwen 0.6B' : 'Qwen 1.7B';
  }
  if (engine === 'luxtts') {
    return 'LuxTTS';
  }
  if (engine === 'chatterbox') {
    return 'Chatterbox';
  }
  if (engine === 'chatterbox_turbo') {
    return 'Chatterbox Turbo';
  }

  return 'Unknown';
}

export function getEffectiveModelSize(
  engine: TTSEngine,
  modelSize?: TTSModelSize | null,
): TTSModelSize {
  if (engine === 'qwen') {
    return modelSize === '0.6B' ? '0.6B' : '1.7B';
  }
  return 'default';
}

export function getEngineLabel(engine: TTSEngine): string {
  return TTS_ENGINE_OPTIONS.find((option) => option.value === engine)?.label ?? engine;
}

export function getModelSelectionFromName(modelName?: string | null): {
  modelName: string;
  engine: TTSEngine;
  modelSize: TTSModelSize;
} {
  const option =
    GENERATION_MODEL_OPTIONS.find((item) => item.modelName === modelName) ??
    GENERATION_MODEL_OPTIONS[0];
  return {
    modelName: option.modelName,
    engine: option.engine,
    modelSize: option.modelSize,
  };
}

export function getGenerationModelSelection(
  language?: string | null,
  preferred?: {
    modelName?: string | null;
    engine?: TTSEngine | null;
    modelSize?: TTSModelSize | null;
  },
): GenerationModelOption {
  const compatibleOptions = getGenerationModelOptions(language);
  const options = compatibleOptions.length > 0 ? compatibleOptions : GENERATION_MODEL_OPTIONS;
  const preferredModelName =
    preferred?.modelName ??
    (preferred?.engine ? getModelNameForSelection(preferred.engine, preferred.modelSize) : null);
  return (
    options.find((option) => option.modelName === preferredModelName) ??
    options[0] ??
    GENERATION_MODEL_OPTIONS[0]
  );
}

export function isLanguageSupportedByEngine(
  engine: TTSEngine,
  language?: string | null,
): language is LanguageCode {
  return Boolean(language && ENGINE_LANGUAGE_CODES[engine].includes(language as LanguageCode));
}

export const TRANSCRIPTION_MODEL_OPTIONS: Array<{
  value: WhisperModelSize;
  label: string;
}> = [
  { value: 'base', label: 'Whisper Base' },
  { value: 'small', label: 'Whisper Small' },
  { value: 'medium', label: 'Whisper Medium' },
  { value: 'large', label: 'Whisper Large' },
  { value: 'turbo', label: 'Whisper Turbo' },
];

export type TranscriptionModelCode = WhisperModelSize | 'default';

export function getTranscriptionModelDisplayName(model: TranscriptionModelCode): string {
  if (model === 'default') {
    return 'Whisper Base';
  }
  return TRANSCRIPTION_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model;
}

export function getTranscriptionLanguageValue(
  language?: TranscriptionLanguageCode,
): LanguageCode | undefined {
  if (!language || language === 'auto') {
    return undefined;
  }
  return language;
}
