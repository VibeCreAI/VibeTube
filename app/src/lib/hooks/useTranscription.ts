import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { TranscriptionLanguageCode } from '@/lib/constants/languages';

export function useTranscription() {
  return useMutation({
    mutationFn: ({ file, language }: { file: File; language?: TranscriptionLanguageCode }) =>
      apiClient.transcribeAudio(file, language),
  });
}
