import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { GenerationResponse } from '@/lib/api/types';
import { LANGUAGE_CODES, type LanguageCode } from '@/lib/constants/languages';
import {
  engineSupportsInstruct,
  getGenerationModelSelection,
  getModelDisplayNameForSelection,
  getModelNameForSelection,
  type TTSEngine,
} from '@/lib/constants/tts';
import { useGeneration } from '@/lib/hooks/useGeneration';
import { useModelDownloadToast } from '@/lib/hooks/useModelDownloadToast';
import { useGenerationStore } from '@/stores/generationStore';
import { usePlayerStore } from '@/stores/playerStore';

const generationSchema = z.object({
  text: z.string().min(1, 'Text is required').max(5000),
  language: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]),
  seed: z.number().int().optional(),
  engine: z.enum(['qwen', 'luxtts', 'chatterbox', 'chatterbox_turbo']),
  modelSize: z.enum(['1.7B', '0.6B', 'default']).optional(),
  instruct: z.string().max(500).optional(),
});

export type GenerationFormValues = z.infer<typeof generationSchema>;

interface UseGenerationFormOptions {
  onSuccess?: (
    generationId: string,
    generation: GenerationResponse,
    helpers: {
      setStatusMessage: (message: string) => void;
    },
  ) => void | Promise<void>;
  defaultValues?: Partial<GenerationFormValues>;
  autoPlayAudioOnSuccess?: boolean;
}

export function useGenerationForm(options: UseGenerationFormOptions = {}) {
  const { toast } = useToast();
  const generation = useGeneration();
  const setAudioWithAutoPlay = usePlayerStore((state) => state.setAudioWithAutoPlay);
  const setIsGenerating = useGenerationStore((state) => state.setIsGenerating);
  const [downloadingModelName, setDownloadingModelName] = useState<string | null>(null);
  const [downloadingDisplayName, setDownloadingDisplayName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  useModelDownloadToast({
    modelName: downloadingModelName || '',
    displayName: downloadingDisplayName || '',
    enabled: !!downloadingModelName,
  });

  const form = useForm<GenerationFormValues>({
    resolver: zodResolver(generationSchema),
    defaultValues: {
      text: '',
      language: 'en',
      seed: undefined,
      engine: 'qwen',
      modelSize: '1.7B',
      instruct: '',
      ...options.defaultValues,
    },
  });
  const autoPlayAudioOnSuccess = options.autoPlayAudioOnSuccess ?? true;
  const watchedEngine = form.watch('engine');
  const watchedLanguage = form.watch('language');
  const watchedModelSize = form.watch('modelSize');

  useEffect(() => {
    if (!watchedEngine || !watchedLanguage) {
      return;
    }

    const selection = getGenerationModelSelection(watchedLanguage, {
      engine: watchedEngine,
      modelSize: watchedModelSize,
    });

    if (form.getValues('engine') !== selection.engine) {
      form.setValue('engine', selection.engine, {
        shouldDirty: false,
        shouldValidate: true,
      });
    }

    if (form.getValues('modelSize') !== selection.modelSize) {
      form.setValue('modelSize', selection.modelSize, {
        shouldDirty: false,
        shouldValidate: true,
      });
    }
  }, [form, watchedEngine, watchedLanguage, watchedModelSize]);

  async function handleSubmit(
    data: GenerationFormValues,
    selectedProfileId: string | null,
  ): Promise<void> {
    if (!selectedProfileId) {
      toast({
        title: 'No profile selected',
        description: 'Please select a voice profile from the cards above.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsGenerating(true);
      setStatusMessage('Checking model...');

      const engine = data.engine as TTSEngine;
      const modelSelection = getGenerationModelSelection(data.language, {
        engine,
        modelSize: data.modelSize,
      });
      const modelName = getModelNameForSelection(modelSelection.engine, modelSelection.modelSize);
      const displayName = getModelDisplayNameForSelection(
        modelSelection.engine,
        modelSelection.modelSize,
      );

      try {
        const modelStatus = await apiClient.getModelStatus();
        const model = modelStatus.models.find((m) => m.model_name === modelName);

        if (model && !model.downloaded) {
          setDownloadingModelName(modelName);
          setDownloadingDisplayName(displayName);
        }
      } catch (error) {
        console.error('Failed to check model status:', error);
      }

      setStatusMessage('Generating audio...');
      const result = await generation.mutateAsync({
        profile_id: selectedProfileId,
        text: data.text,
        language: data.language,
        seed: data.seed,
        engine: modelSelection.engine,
        model_size: modelSelection.modelSize,
        instruct: engineSupportsInstruct(modelSelection.engine) ? data.instruct || undefined : undefined,
      });

      toast({
        title: 'Generation complete!',
        description: `Audio generated (${result.duration.toFixed(2)}s)`,
      });

      if (autoPlayAudioOnSuccess) {
        setStatusMessage('Preparing playback...');
        const audioUrl = apiClient.getAudioUrl(result.id);
        setAudioWithAutoPlay(audioUrl, result.id, selectedProfileId, data.text.substring(0, 50));
      }

      form.reset();
      if (options.onSuccess) {
        try {
          await options.onSuccess(result.id, result, {
            setStatusMessage,
          });
        } catch (error) {
          console.error('onSuccess callback failed:', error);
        }
      }
    } catch (error) {
      toast({
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Failed to generate audio',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
      setDownloadingModelName(null);
      setDownloadingDisplayName(null);
      setStatusMessage('');
    }
  }

  return {
    form,
    handleSubmit,
    isPending: generation.isPending,
    statusMessage,
  };
}
