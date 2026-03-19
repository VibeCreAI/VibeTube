import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { WhisperModelSize } from '@/lib/constants/tts';
import { getPreferredWhisperModel, setPreferredWhisperModel } from '@/lib/utils/vibetubeSettings';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import { useModelDownloadToast } from '@/lib/hooks/useModelDownloadToast';

const TTS_DESCRIPTIONS: Record<string, string> = {
  'qwen-tts-1.7B': 'High-quality multilingual voice cloning with natural prosody. Supports delivery instructions — control tone, pace, and emotion with natural language. 10 languages, ~3.5 GB.',
  'qwen-tts-0.6B': 'Faster, lighter Qwen TTS variant. Good quality with instruct support. Best when VRAM is limited. 10 languages, ~1.2 GB.',
  'luxtts': 'Ultra-fast, CPU-friendly voice cloning at 48kHz. Exceeds 150x realtime on CPU with ~1 GB VRAM. The fastest engine for quick iterations. English only.',
  'chatterbox-tts': 'Production-grade voice cloning with broad language support. Zero-shot cloning and emotion exaggeration control. 23 languages, ~3.2 GB.',
  'chatterbox-turbo': 'Lightweight and fast. Supports paralinguistic tags — embed [laugh], [sigh], [gasp] and more in text for expressive, natural speech. English only, ~1.5 GB.',
};

const WHISPER_DESCRIPTIONS: Record<string, string> = {
  'whisper-base': 'Fastest, ~74 MB. Good for quick drafts on low-end hardware.',
  'whisper-small': 'Fast with decent accuracy, ~244 MB. Good for simple content.',
  'whisper-medium': 'Balanced accuracy and speed, ~769 MB. Suitable for most use cases.',
  'whisper-large': 'Highest accuracy, ~2.9 GB. Best for complex or multilingual audio.',
  'whisper-turbo': 'Best speed/accuracy tradeoff, ~809 MB. Recommended for most use cases.',
};

const WHISPER_RECOMMENDED = 'whisper-turbo';

export function ModelManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadingDisplayName, setDownloadingDisplayName] = useState<string | null>(null);
  const [preferredWhisper, setPreferredWhisper] = useState<WhisperModelSize | null>(
    () => getPreferredWhisperModel(),
  );

  const { data: modelStatus, isLoading } = useQuery({
    queryKey: ['modelStatus'],
    queryFn: async () => {
      console.log('[Query] Fetching model status');
      const result = await apiClient.getModelStatus();
      console.log('[Query] Model status fetched:', result);
      return result;
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Callbacks for download completion
  const handleDownloadComplete = useCallback(() => {
    console.log('[ModelManagement] Download complete, clearing state');
    setDownloadingModel(null);
    setDownloadingDisplayName(null);
    queryClient.invalidateQueries({ queryKey: ['modelStatus'] });
  }, [queryClient]);

  const handleDownloadError = useCallback(() => {
    console.log('[ModelManagement] Download error, clearing state');
    setDownloadingModel(null);
    setDownloadingDisplayName(null);
  }, []);

  // Use progress toast hook for the downloading model
  useModelDownloadToast({
    modelName: downloadingModel || '',
    displayName: downloadingDisplayName || '',
    enabled: !!downloadingModel && !!downloadingDisplayName,
    onComplete: handleDownloadComplete,
    onError: handleDownloadError,
  });

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<{
    name: string;
    displayName: string;
    sizeMb?: number;
  } | null>(null);

  const handleSelectWhisper = (modelSize: WhisperModelSize) => {
    setPreferredWhisperModel(modelSize);
    setPreferredWhisper(modelSize);
  };

  const handleDownload = async (modelName: string) => {
    console.log('[Download] Button clicked for:', modelName, 'at', new Date().toISOString());
    
    // Find display name
    const model = modelStatus?.models.find((m) => m.model_name === modelName);
    const displayName = model?.display_name || modelName;
    
    try {
      // IMPORTANT: Call the API FIRST before setting state
      // Setting state enables the SSE EventSource in useModelDownloadToast,
      // which can block/delay the download fetch due to HTTP/1.1 connection limits
      console.log('[Download] Calling download API for:', modelName);
      const result = await apiClient.triggerModelDownload(modelName);
      console.log('[Download] Download API responded:', result);
      
      // NOW set state to enable SSE tracking (after download has started on backend)
      setDownloadingModel(modelName);
      setDownloadingDisplayName(displayName);
      
      // Download initiated successfully - state will be cleared when SSE reports completion
      // or by the polling interval detecting the model is downloaded
      queryClient.invalidateQueries({ queryKey: ['modelStatus'] });
    } catch (error) {
      console.error('[Download] Download failed:', error);
      setDownloadingModel(null);
      setDownloadingDisplayName(null);
      toast({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (modelName: string) => {
      console.log('[Delete] Deleting model:', modelName);
      const result = await apiClient.deleteModel(modelName);
      console.log('[Delete] Model deleted successfully:', modelName);
      return result;
    },
    onSuccess: async (_data, _modelName) => {
      console.log('[Delete] onSuccess - showing toast and invalidating queries');
      toast({
        title: 'Model deleted',
        description: `${modelToDelete?.displayName || 'Model'} has been deleted successfully.`,
      });
      setDeleteDialogOpen(false);
      setModelToDelete(null);
      // Invalidate AND explicitly refetch to ensure UI updates
      // Using refetchType: 'all' ensures we refetch even if the query is stale
      console.log('[Delete] Invalidating modelStatus query');
      await queryClient.invalidateQueries({ 
        queryKey: ['modelStatus'],
        refetchType: 'all',
      });
      // Also explicitly refetch to guarantee fresh data
      console.log('[Delete] Explicitly refetching modelStatus query');
      await queryClient.refetchQueries({ queryKey: ['modelStatus'] });
      console.log('[Delete] Query refetched');
    },
    onError: (error: Error) => {
      console.log('[Delete] onError:', error);
      toast({
        title: 'Delete failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const formatSize = (sizeMb?: number): string => {
    if (!sizeMb) return 'Unknown';
    if (sizeMb < 1024) return `${sizeMb.toFixed(1)} MB`;
    return `${(sizeMb / 1024).toFixed(2)} GB`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Management</CardTitle>
        <CardDescription>
          Download and manage AI models for voice generation and transcription
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : modelStatus ? (
          <div className="space-y-4">
            {/* TTS Models */}
            <div>
              <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
                Voice Generation Models
              </h3>
              <div className="space-y-2">
                {modelStatus.models
                  .filter((m) => m.engine && m.engine !== 'whisper')
                  .map((model) => (
                    <ModelItem
                      key={model.model_name}
                      model={model}
                      onDownload={() => handleDownload(model.model_name)}
                      onDelete={() => {
                        setModelToDelete({
                          name: model.model_name,
                          displayName: model.display_name,
                          sizeMb: model.size_mb,
                        });
                        setDeleteDialogOpen(true);
                      }}
                      isDownloading={downloadingModel === model.model_name}
                      formatSize={formatSize}
                      description={TTS_DESCRIPTIONS[model.model_name]}
                    />
                  ))}
              </div>
            </div>

            {/* Whisper Models */}
            <div>
              <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
                Transcription Models
              </h3>
              <div className="space-y-2">
                {modelStatus.models
                  .filter((m) => m.model_name.startsWith('whisper'))
                  .map((model) => (
                    <ModelItem
                      key={model.model_name}
                      model={model}
                      onDownload={() => handleDownload(model.model_name)}
                      onDelete={() => {
                        setModelToDelete({
                          name: model.model_name,
                          displayName: model.display_name,
                          sizeMb: model.size_mb,
                        });
                        setDeleteDialogOpen(true);
                      }}
                      isDownloading={downloadingModel === model.model_name}
                      formatSize={formatSize}
                      description={WHISPER_DESCRIPTIONS[model.model_name]}
                      isRecommended={model.model_name === WHISPER_RECOMMENDED}
                      isSelected={preferredWhisper === model.model_size}
                      onSelect={
                        model.model_size
                          ? () => handleSelectWhisper(model.model_size as WhisperModelSize)
                          : undefined
                      }
                    />
                  ))}
              </div>
            </div>

          </div>
        ) : null}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Model</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{modelToDelete?.displayName}</strong>?
              {modelToDelete?.sizeMb && (
                <>
                  {' '}
                  This will free up {formatSize(modelToDelete.sizeMb)} of disk space. The model will
                  need to be re-downloaded if you want to use it again.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (modelToDelete) {
                  deleteMutation.mutate(modelToDelete.name);
                }
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

interface ModelItemProps {
  model: {
    model_name: string;
    display_name: string;
    engine?: string;
    model_size?: string;
    downloaded: boolean;
    downloading?: boolean;  // From server - true if download in progress
    size_mb?: number;
    loaded: boolean;
  };
  onDownload: () => void;
  onDelete: () => void;
  isDownloading: boolean;  // Local state - true if user just clicked download
  formatSize: (sizeMb?: number) => string;
  description?: string;
  isRecommended?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
}

function ModelItem({
  model,
  onDownload,
  onDelete,
  isDownloading,
  formatSize,
  description,
  isRecommended,
  isSelected,
  onSelect,
}: ModelItemProps) {
  // Use server's downloading state OR local state (for immediate feedback before server updates)
  const showDownloading = model.downloading || isDownloading;

  return (
    <div className={`flex items-center justify-between p-3 border rounded-lg ${isSelected ? 'border-primary bg-primary/5' : ''}`}>
      <div className="flex-1 min-w-0 mr-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{model.display_name}</span>
          {isRecommended && (
            <Badge variant="outline" className="text-xs border-primary text-primary">
              Recommended
            </Badge>
          )}
          {isSelected && (
            <Badge variant="default" className="text-xs">
              Active
            </Badge>
          )}
          {model.loaded && !isSelected && (
            <Badge variant="secondary" className="text-xs">
              Loaded
            </Badge>
          )}
          {model.downloaded && !model.loaded && !showDownloading && !isSelected && (
            <Badge variant="outline" className="text-xs">
              Downloaded
            </Badge>
          )}
        </div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        )}
        {model.downloaded && model.size_mb && !showDownloading && (
          <div className="text-xs text-muted-foreground mt-0.5">
            On disk: {formatSize(model.size_mb)}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onSelect && !isSelected && (
          <Button
            size="sm"
            variant="outline"
            onClick={onSelect}
            title="Set as active transcription model"
          >
            <Check className="h-4 w-4 mr-1" />
            Use
          </Button>
        )}
        {model.downloaded && !showDownloading ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={onDelete}
              variant="outline"
              disabled={model.loaded}
              title={model.loaded ? 'Unload model before deleting' : 'Delete model'}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : showDownloading ? (
          <Button size="sm" variant="outline" disabled>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Downloading...
          </Button>
        ) : (
          <Button size="sm" onClick={onDownload} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        )}
      </div>
    </div>
  );
}
