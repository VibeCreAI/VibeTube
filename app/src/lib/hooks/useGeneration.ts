import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { GenerationRequest } from '@/lib/api/types';

export function useGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: GenerationRequest) => apiClient.generateSpeech(data),
    onSuccess: async () => {
      // Force active history queries to refresh after generation completion.
      await queryClient.invalidateQueries({
        queryKey: ['history'],
        refetchType: 'active',
      });
    },
  });
}
