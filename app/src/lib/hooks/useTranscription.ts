import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { TranscriptionLanguageCode } from '@/lib/constants/languages';
import type { WhisperModelSize } from '@/lib/constants/tts';
import { getPreferredWhisperModel } from '@/lib/utils/vibetubeSettings';

export function useTranscription() {
  return useMutation({
    mutationFn: ({
      file,
      language,
      model,
    }: {
      file: File;
      language?: TranscriptionLanguageCode;
      model?: WhisperModelSize;
    }) => apiClient.transcribeAudio(file, language, model ?? getPreferredWhisperModel() ?? undefined),
  });
}
