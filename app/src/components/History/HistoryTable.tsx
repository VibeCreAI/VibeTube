import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AudioWaveform,
  Clapperboard,
  Download,
  Eye,
  Loader2,
  MoreHorizontal,
  Play,
  PlayCircle,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HistoryRegenerateDialog } from '@/components/History/HistoryRegenerateDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type {
  GenerationRequest,
  HistoryResponse,
  VibeTubeExportFormat,
  VibeTubeJobResponse,
} from '@/lib/api/types';
import {
  getGenerationAudioLabel,
  getModelDisplayNameForSelection,
  getModelNameForSelection,
} from '@/lib/constants/tts';
import { BOTTOM_SAFE_AREA_PADDING } from '@/lib/constants/ui';
import { useGeneration } from '@/lib/hooks/useGeneration';
import {
  useDeleteGeneration,
  useExportGenerationAudio,
  useHistory,
  useImportGeneration,
} from '@/lib/hooks/useHistory';
import { useProfile, useProfiles } from '@/lib/hooks/useProfiles';
import { cn } from '@/lib/utils/cn';
import { formatDate, formatDuration } from '@/lib/utils/format';
import {
  getPersistedVibeTubeBackgroundImageFileAsync,
  getPersistedVibeTubeRenderSettings,
} from '@/lib/utils/vibetubeSettings';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';

// OLD TABLE-BASED COMPONENT - REMOVED (can be found in git history)
// This is the new alternate history view with fixed height rows

function getPrimaryVibeExportFormat(job: VibeTubeJobResponse | null): VibeTubeExportFormat {
  if (!job) {
    return 'mp4';
  }
  if (job.preferred_export_format === 'webm' || job.preferred_export_format === 'mov') {
    return job.preferred_export_format;
  }
  if (job.contains_transparency) {
    return 'mov';
  }
  return 'mp4';
}

function getExportButtonLabel(format: VibeTubeExportFormat): string {
  if (format === 'webm') return 'Export WebM';
  if (format === 'mov') return 'Export MOV';
  return 'Export MP4';
}

// NEW ALTERNATE HISTORY VIEW - FIXED HEIGHT ROWS WITH INFINITE SCROLL
export function HistoryTable() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [allHistory, setAllHistory] = useState<HistoryResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showSelectedProfileOnly, setShowSelectedProfileOnly] = useState(false);
  const [selectedGenerationIds, setSelectedGenerationIds] = useState<string[]>([]);
  const [focusedGenerationId, setFocusedGenerationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const regenerateRequestRef = useRef(0);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [generationToDelete, setGenerationToDelete] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [vibeDialogOpen, setVibeDialogOpen] = useState(false);
  const [selectedGeneration, setSelectedGeneration] = useState<HistoryResponse | null>(null);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [generationToRegenerate, setGenerationToRegenerate] = useState<HistoryResponse | null>(
    null,
  );
  const [regenerateStatusMessage, setRegenerateStatusMessage] = useState('');
  const [selectedVibeJobId, setSelectedVibeJobId] = useState<string | null>(null);
  const [renderingGenerationIds, setRenderingGenerationIds] = useState<Set<string>>(new Set());
  const [isDeletingVibeRender, setIsDeletingVibeRender] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const limit = 20;
  const { toast } = useToast();
  const selectedProfileId = useUIStore((state) => state.selectedProfileId);
  const setSelectedProfileId = useUIStore((state) => state.setSelectedProfileId);
  const { data: selectedProfile } = useProfile(selectedProfileId || '');
  const { data: profiles } = useProfiles();
  const historyProfileId = showSelectedProfileOnly ? selectedProfileId || undefined : undefined;
  const historyFilterKey = historyProfileId || '__all__';

  const {
    data: historyData,
    isLoading,
    isFetching,
  } = useHistory({
    exclude_story_generations: true,
    profile_id: historyProfileId,
    limit,
    offset: page * limit,
  });

  const deleteGeneration = useDeleteGeneration();
  const exportGenerationAudio = useExportGenerationAudio();
  const importGeneration = useImportGeneration();
  const regenerateGeneration = useGeneration();
  const setAudioWithAutoPlay = usePlayerStore((state) => state.setAudioWithAutoPlay);
  const restartCurrentAudio = usePlayerStore((state) => state.restartCurrentAudio);
  const currentAudioId = usePlayerStore((state) => state.audioId);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const audioUrl = usePlayerStore((state) => state.audioUrl);
  const isPlayerVisible = !!audioUrl;
  const vibetubeJobsQuery = useQuery({
    queryKey: ['vibetube-jobs'],
    queryFn: () => apiClient.listVibeTubeJobs(),
  });

  const resetHistoryPagination = useCallback(() => {
    setPage(0);
    setAllHistory([]);
    setTotal(0);
  }, []);

  useEffect(() => {
    if (showSelectedProfileOnly && !selectedProfileId) {
      setShowSelectedProfileOnly(false);
    }
  }, [showSelectedProfileOnly, selectedProfileId]);

  useEffect(() => {
    const activeFilter = historyFilterKey;
    if (!activeFilter) return;
    resetHistoryPagination();
  }, [historyFilterKey, resetHistoryPagination]);

  // Update accumulated history when new data arrives
  useEffect(() => {
    if (historyData?.items) {
      setTotal(historyData.total);
      if (page === 0) {
        // Reset to first page
        setAllHistory(historyData.items);
      } else if (historyData.items.length === 0 && historyData.total > 0 && allHistory.length === 0) {
        // If we ever land on an empty non-zero page with non-empty history,
        // snap back to page 0 instead of showing a blank list.
        setPage(0);
      } else {
        // Append new items, avoiding duplicates
        setAllHistory((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          const newItems = historyData.items.filter((item) => !existingIds.has(item.id));
          return [...prev, ...newItems];
        });
      }
    }
  }, [historyData, page, allHistory.length]);

  // Reset to page 0 when deletions or imports occur
  useEffect(() => {
    if (deleteGeneration.isSuccess || importGeneration.isSuccess) {
      resetHistoryPagination();
    }
  }, [deleteGeneration.isSuccess, importGeneration.isSuccess, resetHistoryPagination]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const loadMoreEl = loadMoreRef.current;
    if (!loadMoreEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (
          target.isIntersecting &&
          !isFetching &&
          allHistory.length > 0 &&
          allHistory.length < total
        ) {
          setPage((prev) => prev + 1);
        }
      },
      {
        root: scrollRef.current,
        rootMargin: '100px',
        threshold: 0.1,
      },
    );

    observer.observe(loadMoreEl);
    return () => observer.disconnect();
  }, [isFetching, allHistory.length, total]);

  // Track scroll position for gradient effect
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleScroll = () => {
      setIsScrolled(scrollEl.scrollTop > 0);
    };

    scrollEl.addEventListener('scroll', handleScroll);
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, []);

  const handlePlay = (audioId: string, text: string, profileId: string) => {
    // If clicking the same audio, restart it from the beginning
    if (currentAudioId === audioId) {
      restartCurrentAudio();
    } else {
      // Otherwise, load the new audio and auto-play it
      const audioUrl = apiClient.getAudioUrl(audioId);
      setAudioWithAutoPlay(audioUrl, audioId, profileId, text.substring(0, 50));
    }
  };

  const handleDownloadAudio = (generationId: string, text: string) => {
    exportGenerationAudio.mutate(
      { generationId, text },
      {
        onError: (error) => {
          toast({
            title: 'Failed to download audio',
            description: error.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleDeleteClick = (generationId: string, profileName: string) => {
    setGenerationToDelete({ id: generationId, name: profileName });
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (generationToDelete) {
      deleteGeneration.mutate(generationToDelete.id);
      setDeleteDialogOpen(false);
      setGenerationToDelete(null);
    }
  };

  const handleRegenerateClick = (generation: HistoryResponse) => {
    setGenerationToRegenerate(generation);
    setRegenerateDialogOpen(true);
  };

  const handleRegenerateSubmit = async (data: GenerationRequest) => {
    const requestId = ++regenerateRequestRef.current;
    setRegenerateStatusMessage('Checking model...');
    try {
      const engine = data.engine || 'qwen';
      const modelName = getModelNameForSelection(engine, data.model_size);
      const displayName = getModelDisplayNameForSelection(engine, data.model_size);
      const modelStatus = await apiClient.getModelStatus();
      const model = modelStatus.models.find((entry) => entry.model_name === modelName);
      if (model && !model.downloaded) {
        setRegenerateStatusMessage(`Downloading ${displayName}...`);
      } else {
        setRegenerateStatusMessage('Generating audio...');
      }
    } catch {
      setRegenerateStatusMessage('Generating audio...');
    }

    regenerateGeneration.mutate(data, {
      onSuccess: async (result) => {
        if (requestId !== regenerateRequestRef.current) {
          return;
        }
        resetHistoryPagination();
        await queryClient.invalidateQueries({ queryKey: ['history'] });
        await queryClient.refetchQueries({ queryKey: ['history'] });
        setRegenerateDialogOpen(false);
        setGenerationToRegenerate(null);
        setRegenerateStatusMessage('');
        toast({
          title: 'Audio regenerated',
          description: 'A new generation was created from this clip.',
        });
        const regeneratedAudioUrl = apiClient.getAudioUrl(result.id);
        setAudioWithAutoPlay(
          regeneratedAudioUrl,
          result.id,
          result.profile_id,
          result.text.substring(0, 50),
        );
      },
      onError: (error) => {
        if (requestId !== regenerateRequestRef.current) {
          return;
        }
        setRegenerateStatusMessage('');
        toast({
          title: 'Failed to regenerate audio',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      },
    });
  };

  const openVibeDialog = (gen: HistoryResponse) => {
    setSelectedGeneration(gen);
    setSelectedVibeJobId(null);
    vibetubeJobsQuery.refetch();
    setVibeDialogOpen(true);
  };

  const getLatestLinkedJob = (gen: HistoryResponse): VibeTubeJobResponse | null => {
    const jobs = (vibetubeJobsQuery.data ?? []).filter(
      (job) => job.source_generation_id === gen.id,
    );
    if (!jobs.length) {
      return null;
    }
    jobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return jobs[0] ?? null;
  };

  const handlePlayLatestVideo = (gen: HistoryResponse) => {
    const latest = getLatestLinkedJob(gen);
    if (!latest) {
      toast({
        title: 'No linked video yet',
        description: 'Render a video first, then Play Video will open the latest linked render.',
      });
      return;
    }
    setSelectedGeneration(gen);
    setSelectedVibeJobId(latest.job_id);
    setVibeDialogOpen(true);
  };

  const handleRenderVibeTube = async (gen: HistoryResponse) => {
    setRenderingGenerationIds((prev) => {
      const next = new Set(prev);
      next.add(gen.id);
      return next;
    });
    toast({
      title: 'Rendering video...',
      description: 'VibeTube render started in background for this generation.',
    });
    try {
      const settings = getPersistedVibeTubeRenderSettings();
      const backgroundImage = settings.use_background_image
        ? await getPersistedVibeTubeBackgroundImageFileAsync()
        : undefined;
      const result = await apiClient.renderVibeTube({
        profile_id: gen.profile_id,
        generation_id: gen.id,
        ...settings,
        background_image: backgroundImage,
      });
      await queryClient.invalidateQueries({ queryKey: ['vibetube-jobs'] });
      setSelectedVibeJobId(result.job_id);
      toast({
        title: 'VibeTube render complete',
        description: `Render ${result.job_id.slice(0, 8)} linked to this generation.`,
      });
      openVibeDialog(gen);
    } catch (error) {
      toast({
        title: 'Render failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setRenderingGenerationIds((prev) => {
        const next = new Set(prev);
        next.delete(gen.id);
        return next;
      });
    }
  };

  const linkedJobs: VibeTubeJobResponse[] = (vibetubeJobsQuery.data ?? []).filter(
    (job) => selectedGeneration && job.source_generation_id === selectedGeneration.id,
  );
  const selectedVibeJob =
    linkedJobs.find((job) => job.job_id === selectedVibeJobId) ?? linkedJobs[0] ?? null;
  const primaryVibeExportFormat = getPrimaryVibeExportFormat(selectedVibeJob);
  const linkedJobsByGenerationId = useMemo(() => {
    const jobsByGenerationId: Record<string, string[]> = {};
    for (const job of vibetubeJobsQuery.data ?? []) {
      if (!job.source_generation_id) continue;
      if (!jobsByGenerationId[job.source_generation_id]) {
        jobsByGenerationId[job.source_generation_id] = [];
      }
      jobsByGenerationId[job.source_generation_id]?.push(job.job_id);
    }
    return jobsByGenerationId;
  }, [vibetubeJobsQuery.data]);

  useEffect(() => {
    const validGenerationIds = new Set(allHistory.map((item) => item.id));
    setSelectedGenerationIds((prev) => prev.filter((id) => validGenerationIds.has(id)));
    setFocusedGenerationId((prev) => (prev && validGenerationIds.has(prev) ? prev : null));
  }, [allHistory]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-history-generation-row="true"]')) {
        return;
      }
      setFocusedGenerationId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const handleFocusGeneration = (generation: HistoryResponse) => {
    setFocusedGenerationId(generation.id);
    setSelectedProfileId(generation.profile_id);
  };

  const handleDeleteVibeRender = async (jobId: string) => {
    const confirmed = await confirm('Delete this linked VibeTube render?');
    if (!confirmed) return;
    setIsDeletingVibeRender(true);
    try {
      await apiClient.deleteVibeTubeJob(jobId);
      await queryClient.invalidateQueries({ queryKey: ['vibetube-jobs'] });
      if (selectedVibeJobId === jobId) {
        setSelectedVibeJobId(null);
      }
      toast({ title: 'Render deleted', description: 'Linked VibeTube render removed.' });
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsDeletingVibeRender(false);
    }
  };

  const handleExportVibeVideo = async (jobId: string, format: VibeTubeExportFormat) => {
    try {
      const blob = await apiClient.exportVibeTubeVideo(jobId, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vibetube-${jobId}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({
        title: `${format.toUpperCase()} exported`,
        description:
          format === 'webm'
            ? 'Saved linked VibeTube WebM with alpha.'
            : format === 'mov'
              ? 'Saved linked VibeTube MOV with alpha.'
              : 'Saved linked VibeTube MP4.',
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleExportVibeSrt = async (jobId: string) => {
    try {
      const blob = await apiClient.exportVibeTubeSubtitles(jobId, 'srt');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vibetube-${jobId}.srt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Subtitles exported', description: 'Saved linked VibeTube subtitles (SRT).' });
    } catch (error) {
      toast({
        title: 'Subtitle export failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleImportConfirm = () => {
    if (selectedFile) {
      importGeneration.mutate(selectedFile, {
        onSuccess: (data) => {
          setImportDialogOpen(false);
          setSelectedFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          toast({
            title: 'Generation imported',
            description: data.message || 'Generation imported successfully',
          });
        },
        onError: (error) => {
          toast({
            title: 'Failed to import generation',
            description: error.message,
            variant: 'destructive',
          });
        },
      });
    }
  };

  if (isLoading && page === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const history = allHistory;
  const hasMore = allHistory.length < total;
  const allVisibleGenerationIds = history.map((gen) => gen.id);
  const allSelected =
    allVisibleGenerationIds.length > 0 &&
    selectedGenerationIds.length === allVisibleGenerationIds.length;

  const handleToggleAllGenerations = (checked: boolean) => {
    setSelectedGenerationIds(checked ? allVisibleGenerationIds : []);
  };

  const handleToggleGeneration = (generationId: string, checked: boolean) => {
    setSelectedGenerationIds((prev) =>
      checked ? [...new Set([...prev, generationId])] : prev.filter((id) => id !== generationId),
    );
  };

  const handleBulkDelete = async () => {
    if (selectedGenerationIds.length === 0) return;

    const linkedJobIds = selectedGenerationIds.flatMap(
      (generationId) => linkedJobsByGenerationId[generationId] ?? [],
    );
    const confirmed = await confirm(
      `Delete ${selectedGenerationIds.length} selected generation${selectedGenerationIds.length === 1 ? '' : 's'}${linkedJobIds.length > 0 ? ` and ${linkedJobIds.length} linked video render${linkedJobIds.length === 1 ? '' : 's'}` : ''}? This action cannot be undone.`,
    );
    if (!confirmed) return;

    setIsBulkDeleting(true);
    try {
      const renderDeletionResults = await Promise.allSettled(
        [...new Set(linkedJobIds)].map((jobId) => apiClient.deleteVibeTubeJob(jobId)),
      );
      const generationDeletionResults = await Promise.allSettled(
        selectedGenerationIds.map((generationId) => deleteGeneration.mutateAsync(generationId)),
      );

      const deletedRenderCount = renderDeletionResults.filter(
        (result) => result.status === 'fulfilled',
      ).length;
      const failedRenderCount = renderDeletionResults.length - deletedRenderCount;
      const deletedGenerationCount = generationDeletionResults.filter(
        (result) => result.status === 'fulfilled',
      ).length;
      const failedGenerationCount = generationDeletionResults.length - deletedGenerationCount;

      setSelectedGenerationIds([]);
      resetHistoryPagination();
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      await queryClient.invalidateQueries({ queryKey: ['vibetube-jobs'] });

      if (deletedGenerationCount > 0 || deletedRenderCount > 0) {
        const parts: string[] = [];
        if (deletedGenerationCount > 0) {
          parts.push(
            `${deletedGenerationCount} audio generation${deletedGenerationCount === 1 ? '' : 's'}`,
          );
        }
        if (deletedRenderCount > 0) {
          parts.push(`${deletedRenderCount} video render${deletedRenderCount === 1 ? '' : 's'}`);
        }
        toast({
          title: 'Media deleted',
          description: `Deleted ${parts.join(' and ')}.`,
        });
      }

      if (failedGenerationCount > 0 || failedRenderCount > 0) {
        toast({
          title: 'Some deletions failed',
          description: `${failedGenerationCount} generation${failedGenerationCount === 1 ? '' : 's'} and ${failedRenderCount} render${failedRenderCount === 1 ? '' : 's'} could not be deleted.`,
          variant: 'destructive',
        });
      }
    } finally {
      setIsBulkDeleting(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      <div className="shrink-0 flex items-center justify-between gap-3 pb-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Generations</div>
          <div className="text-xs text-muted-foreground">
            {showSelectedProfileOnly && selectedProfile
              ? `Showing ${selectedProfile.name}`
              : 'Showing all profiles'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedGenerationIds.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => setSelectedGenerationIds([])}>
                <Square className="mr-2 h-4 w-4" />
                Clear ({selectedGenerationIds.length})
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {isBulkDeleting
                  ? 'Deleting...'
                  : `Delete Selected (${selectedGenerationIds.length})`}
              </Button>
            </>
          )}
          <div className="flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1.5 text-xs">
            <Checkbox checked={allSelected} onCheckedChange={handleToggleAllGenerations} />
            <span>
              {selectedGenerationIds.length > 0
                ? `${selectedGenerationIds.length} selected`
                : 'Select all visible'}
            </span>
          </div>
          <div
            className={cn(
              'flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1.5 text-xs',
              !selectedProfileId && 'opacity-60',
            )}
          >
            <Checkbox
              checked={showSelectedProfileOnly}
              onCheckedChange={setShowSelectedProfileOnly}
              disabled={!selectedProfileId}
            />
            <span>Filter by Profile</span>
          </div>
        </div>
      </div>
      {history.length === 0 ? (
        <div className="text-center py-12 px-5 border-2 border-dashed mb-5 border-muted rounded-md text-muted-foreground flex-1 flex items-center justify-center">
          No voice generations, yet...
        </div>
      ) : (
        <>
          {isScrolled && (
            <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
          )}
          <div
            ref={scrollRef}
            className={cn(
              'flex-1 min-h-0 overflow-y-auto space-y-2 pb-4',
              isPlayerVisible && BOTTOM_SAFE_AREA_PADDING,
            )}
          >
            {history.map((gen) => {
              const isCurrentlyPlaying = currentAudioId === gen.id && isPlaying;
              const isRenderingVideo = renderingGenerationIds.has(gen.id);
              const isBulkSelected = selectedGenerationIds.includes(gen.id);
              const isFocused = focusedGenerationId === gen.id;
              const latestLinkedJob = getLatestLinkedJob(gen);
              const hasLinkedVideo = !!latestLinkedJob;
              return (
                <div
                  key={gen.id}
                  data-history-generation-row="true"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleFocusGeneration(gen)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleFocusGeneration(gen);
                    }
                  }}
                  className={cn(
                    'border rounded-md p-3 bg-card hover:bg-muted/70 transition-colors text-left w-full',
                    isCurrentlyPlaying && 'bg-muted/70',
                    isFocused && 'border-cyan-400 ring-2 ring-cyan-400/70',
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="shrink-0 pt-1"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={isBulkSelected}
                        onCheckedChange={(checked) => handleToggleGeneration(gen.id, checked)}
                      />
                    </div>

                    {/* Waveform icon */}
                    <div className="flex items-center shrink-0">
                      <AudioWaveform className="h-5 w-5 text-muted-foreground" />
                    </div>

                    {/* Left side - Meta information */}
                    <div className="flex flex-col gap-1.5 w-64 shrink-0 justify-start pt-1">
                      <div className="font-medium text-sm truncate" title={gen.profile_name}>
                        {gen.profile_name}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{gen.language}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(gen.duration)}
                        </span>
                        <span className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {getGenerationAudioLabel({
                            engine: gen.engine,
                            modelSize: gen.model_size,
                            sourceType: gen.source_type,
                          })}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(gen.created_at)}
                      </div>
                      {isRenderingVideo && (
                        <div className="flex items-center gap-1.5 text-xs text-accent">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Rendering video...</span>
                        </div>
                      )}
                    </div>

                    {/* Right side - Transcript textarea */}
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          'rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap break-words select-text transition-all',
                          isFocused ? 'min-h-[72px]' : 'min-h-[72px] line-clamp-3 overflow-hidden',
                        )}
                      >
                        {gen.text}
                      </div>
                    </div>

                    {/* Far right - Ellipsis actions */}
                    <div
                      className="w-10 shrink-0 flex justify-end"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              handleFocusGeneration(gen);
                              handleDownloadAudio(gen.id, gen.text);
                            }}
                            disabled={exportGenerationAudio.isPending}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Export Audio
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              handleFocusGeneration(gen);
                              openVibeDialog(gen);
                            }}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Preview/Export Video
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 pl-[4.5rem]">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleFocusGeneration(gen);
                        handlePlay(gen.id, gen.text, gen.profile_id);
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      className="shrink-0"
                    >
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                      Play Audio
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleFocusGeneration(gen);
                        if (hasLinkedVideo) {
                          handlePlayLatestVideo(gen);
                        } else {
                          void handleRenderVibeTube(gen);
                        }
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      disabled={isRenderingVideo}
                      className="shrink-0"
                    >
                      {hasLinkedVideo ? (
                        <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                      ) : (
                        <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {isRenderingVideo
                        ? 'Rendering...'
                        : hasLinkedVideo
                          ? 'Play Video'
                          : 'Render Video'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleFocusGeneration(gen);
                        handleRegenerateClick(gen);
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      className="shrink-0"
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Regenerate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleFocusGeneration(gen);
                        handleDeleteClick(gen.id, gen.profile_name);
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      disabled={deleteGeneration.isPending}
                      className="shrink-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* Load more trigger element */}
            {hasMore && (
              <div ref={loadMoreRef} className="flex items-center justify-center py-4">
                {isFetching && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
              </div>
            )}

            {/* End of list indicator */}
            {!hasMore && history.length > 0 && (
              <div className="text-center py-4 text-xs text-muted-foreground">
                You've reached the end
              </div>
            )}
          </div>
        </>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Generation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this generation from "{generationToDelete?.name}"?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setGenerationToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteGeneration.isPending}
            >
              {deleteGeneration.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Generation</DialogTitle>
            <DialogDescription>
              Import the generation from "{selectedFile?.name}". This will add it to your history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportDialogOpen(false);
                setSelectedFile(null);
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                }
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleImportConfirm}
              disabled={importGeneration.isPending || !selectedFile}
            >
              {importGeneration.isPending ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={vibeDialogOpen} onOpenChange={setVibeDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Linked VibeTube Renders</DialogTitle>
            <DialogDescription>
              {selectedGeneration
                ? `${selectedGeneration.profile_name} | ${selectedGeneration.text.slice(0, 80)}`
                : 'Select a generation to view linked renders.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {selectedGeneration && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRenderVibeTube(selectedGeneration)}
                  disabled={renderingGenerationIds.has(selectedGeneration.id)}
                >
                  {renderingGenerationIds.has(selectedGeneration.id) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Clapperboard className="mr-2 h-4 w-4" />
                  )}
                  {renderingGenerationIds.has(selectedGeneration.id)
                    ? 'Rendering...'
                    : 'Render New'}
                </Button>
              )}
              {selectedVibeJob && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleExportVibeVideo(selectedVibeJob.job_id, primaryVibeExportFormat)
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {getExportButtonLabel(primaryVibeExportFormat)}
                  </Button>
                  {selectedVibeJob.contains_transparency && primaryVibeExportFormat !== 'mov' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExportVibeVideo(selectedVibeJob.job_id, 'mov')}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Export MOV
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExportVibeSrt(selectedVibeJob.job_id)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Export SRT
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteVibeRender(selectedVibeJob.job_id)}
                    disabled={isDeletingVibeRender}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {isDeletingVibeRender ? 'Deleting...' : 'Delete'}
                  </Button>
                </>
              )}
            </div>

            {selectedVibeJob ? (
              <video
                className="w-full rounded-lg border bg-black/60 max-h-[380px]"
                controls
                autoPlay
                preload="metadata"
                key={selectedVibeJob.job_id}
                src={apiClient.getVibeTubePreviewUrl(selectedVibeJob.job_id)}
              >
                <track kind="captions" />
              </video>
            ) : (
              <div className="text-sm text-muted-foreground">
                No linked render found for this generation yet.
              </div>
            )}

            {linkedJobs.length > 0 && (
              <div className="space-y-2 max-h-44 overflow-y-auto border rounded-md p-2">
                {linkedJobs.map((job) => (
                  <button
                    key={job.job_id}
                    type="button"
                    className={cn(
                      'w-full text-left rounded-md border px-3 py-2 text-sm hover:bg-muted/60 transition-colors',
                      selectedVibeJob?.job_id === job.job_id && 'bg-muted',
                    )}
                    onClick={() => setSelectedVibeJobId(job.job_id)}
                  >
                    <div className="font-medium">{new Date(job.created_at).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(job.created_at)} |{' '}
                      {job.duration_sec != null ? formatDuration(job.duration_sec) : '--'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVibeDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistoryRegenerateDialog
        open={regenerateDialogOpen}
        generation={generationToRegenerate}
        profiles={profiles || []}
        isSubmitting={regenerateGeneration.isPending}
        statusMessage={regenerateStatusMessage}
        onOpenChange={(open) => {
          setRegenerateDialogOpen(open);
          if (!open) {
            setGenerationToRegenerate(null);
            setRegenerateStatusMessage('');
          }
        }}
        onSubmit={handleRegenerateSubmit}
      />
    </div>
  );
}
