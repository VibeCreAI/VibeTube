import { useQuery } from '@tanstack/react-query';
import { Pause, Play, Repeat, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { apiClient } from '@/lib/api/client';
import { formatAudioDuration } from '@/lib/utils/audio';
import { debug } from '@/lib/utils/debug';
import { usePlatform } from '@/platform/PlatformContext';
import { usePlayerStore } from '@/stores/playerStore';

export function AudioPlayer() {
  const platform = usePlatform();
  const {
    audioUrl,
    profileId,
    title,
    isPlaying,
    currentTime,
    duration,
    volume,
    isLooping,
    shouldRestart,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setVolume,
    toggleLoop,
    clearRestartFlag,
    reset,
  } = usePlayerStore();

  // Check if profile has assigned channels (for native audio routing)
  const { data: profileChannels } = useQuery({
    queryKey: ['profile-channels', profileId],
    queryFn: () => {
      if (!profileId) return { channel_ids: [] };
      return apiClient.getProfileChannels(profileId);
    },
    enabled: !!profileId && platform.metadata.isTauri,
  });

  const { data: channels } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiClient.listChannels(),
    enabled: !!profileChannels && profileChannels.channel_ids.length > 0,
  });

  // Determine if we should use native playback
  const useNativePlayback = useMemo(() => {
    if (!platform.metadata.isTauri || !profileChannels || !channels) {
      return false;
    }
    const assignedChannels = channels.filter((ch) => profileChannels.channel_ids.includes(ch.id));
    return assignedChannels.some((ch) => ch.device_ids.length > 0 && !ch.is_default);
  }, [platform.metadata.isTauri, profileChannels, channels]);

  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const nativePlaybackRequestRef = useRef(0);
  const isUsingNativePlaybackRef = useRef(false);
  const isInitializingRef = useRef(false);
  const initRaf1Ref = useRef<number | null>(null);
  const initRaf2Ref = useRef<number | null>(null);
  const initTimeoutRef = useRef<number | null>(null);
  const subscriptionsRef = useRef<Array<() => void>>([]);
  const [isWaveSurferReady, setIsWaveSurferReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type WaveSurferEventBridge = {
    on: (eventName: string, handler: (...args: unknown[]) => void) => (() => void) | undefined;
    unAll?: () => void;
  };

  const stopNativePlayback = useCallback(() => {
    if (!platform.metadata.isTauri) {
      isUsingNativePlaybackRef.current = false;
      return;
    }
    try {
      platform.audio.stopPlayback();
    } catch (err) {
      debug.error('Failed to stop native playback:', err);
    } finally {
      isUsingNativePlaybackRef.current = false;
    }
  }, [platform]);

  const setWaveSurferMutedState = useCallback((muted: boolean) => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer) return;
    const mediaElement = wavesurfer.getMediaElement();
    if (!mediaElement) return;
    if (muted) {
      mediaElement.volume = 0;
      mediaElement.muted = true;
      return;
    }
    const currentVolume = usePlayerStore.getState().volume;
    mediaElement.volume = currentVolume;
    mediaElement.muted = currentVolume === 0;
  }, []);

  const isStalePlaybackRequest = useCallback((requestId: number, targetAudioUrl: string) => {
    return (
      requestId !== nativePlaybackRequestRef.current ||
      usePlayerStore.getState().audioUrl !== targetAudioUrl
    );
  }, []);

  const tryStartNativePlaybackForTrack = useCallback(
    async (targetAudioUrl: string, targetProfileId: string | null, requestId: number) => {
      const wavesurfer = wavesurferRef.current;
      if (!wavesurfer || !platform.metadata.isTauri || !targetProfileId) {
        return false;
      }

      try {
        const runtimeProfileChannels = await apiClient.getProfileChannels(targetProfileId);
        if (isStalePlaybackRequest(requestId, targetAudioUrl)) {
          return false;
        }
        if (!runtimeProfileChannels.channel_ids.length) {
          return false;
        }

        const runtimeChannels = await apiClient.listChannels();
        if (isStalePlaybackRequest(requestId, targetAudioUrl)) {
          return false;
        }

        const assignedChannels = runtimeChannels.filter((ch) =>
          runtimeProfileChannels.channel_ids.includes(ch.id),
        );
        const shouldUseNative = assignedChannels.some(
          (ch) => ch.device_ids.length > 0 && !ch.is_default,
        );
        if (!shouldUseNative) {
          return false;
        }

        const deviceIds = assignedChannels.flatMap((ch) => ch.device_ids);
        if (!deviceIds.length) {
          return false;
        }

        try {
          platform.audio.stopPlayback();
        } catch (_err) {
          // Ignore if nothing is active.
        }

        if (isStalePlaybackRequest(requestId, targetAudioUrl)) {
          return false;
        }

        const response = await fetch(targetAudioUrl);
        const audioData = new Uint8Array(await response.arrayBuffer());
        if (isStalePlaybackRequest(requestId, targetAudioUrl)) {
          return false;
        }

        await platform.audio.playToDevices(audioData, deviceIds);
        if (isStalePlaybackRequest(requestId, targetAudioUrl)) {
          try {
            platform.audio.stopPlayback();
          } catch (_err) {
            // Ignore shutdown errors on stale request cleanup.
          }
          return false;
        }

        isUsingNativePlaybackRef.current = true;
        setWaveSurferMutedState(true);
        if (!wavesurfer.isPlaying()) {
          wavesurfer.play().catch((err) => {
            debug.error('Failed to start WaveSurfer visualization:', err);
          });
        }
        setIsPlaying(true);
        return true;
      } catch (err) {
        debug.error('Native playback failed:', err);
        return false;
      }
    },
    [isStalePlaybackRequest, platform, setIsPlaying, setWaveSurferMutedState],
  );

  // Initialize WaveSurfer once per player mount.
  useEffect(() => {
    if (!audioUrl || wavesurferRef.current || isInitializingRef.current) {
      return;
    }
    isInitializingRef.current = true;

    const register = <TArgs extends unknown[]>(
      eventName: string,
      handler: (...args: TArgs) => void,
    ) => {
      const wavesurfer = wavesurferRef.current;
      if (!wavesurfer) return;
      const bridge = wavesurfer as unknown as WaveSurferEventBridge;
      const unsubscribe = bridge.on(eventName, (...args) => handler(...(args as TArgs)));
      if (typeof unsubscribe === 'function') {
        subscriptionsRef.current.push(unsubscribe as () => void);
      }
    };

    const initWaveSurfer = () => {
      if (!isInitializingRef.current) {
        return;
      }

      const container = waveformRef.current;
      if (!container) {
        initTimeoutRef.current = window.setTimeout(initWaveSurfer, 50);
        return;
      }

      const rect = container.getBoundingClientRect();
      const style = window.getComputedStyle(container);
      const isVisible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden';

      if (!isVisible) {
        initTimeoutRef.current = window.setTimeout(initWaveSurfer, 50);
        return;
      }

      try {
        const root = document.documentElement;
        const getCSSVar = (varName: string) => {
          const value = getComputedStyle(root).getPropertyValue(varName).trim();
          return value ? `hsl(${value})` : '';
        };

        wavesurferRef.current = WaveSurfer.create({
          container,
          waveColor: getCSSVar('--muted'),
          progressColor: getCSSVar('--accent'),
          cursorColor: getCSSVar('--accent'),
          barWidth: 2,
          barRadius: 2,
          height: 80,
          normalize: true,
          backend: 'WebAudio',
          interact: true,
          mediaControls: false,
        });
        setIsWaveSurferReady(true);
        isInitializingRef.current = false;
      } catch (err) {
        debug.error('Failed to initialize WaveSurfer:', err);
        setError(
          `Failed to initialize waveform: ${err instanceof Error ? err.message : String(err)}`,
        );
        isInitializingRef.current = false;
        return;
      }

      register('timeupdate', (time: number) => {
        setCurrentTime(time);
      });

      register('ready', async () => {
        const wavesurfer = wavesurferRef.current;
        if (!wavesurfer) return;
        const readyAudioUrl = activeAudioUrlRef.current;
        if (!readyAudioUrl || usePlayerStore.getState().audioUrl !== readyAudioUrl) {
          debug.log('Ignoring stale ready event');
          return;
        }
        const readyDuration = wavesurfer.getDuration();
        setDuration(readyDuration);
        setIsLoading(false);
        setError(null);

        const currentVolume = usePlayerStore.getState().volume;
        wavesurfer.setVolume(currentVolume);
        if (!isUsingNativePlaybackRef.current) {
          setWaveSurferMutedState(false);
        }

        const shouldAutoPlayNow = usePlayerStore.getState().shouldAutoPlay;
        if (!shouldAutoPlayNow) {
          return;
        }

        const requestId = ++nativePlaybackRequestRef.current;

        const startedNative = await tryStartNativePlaybackForTrack(
          readyAudioUrl,
          usePlayerStore.getState().profileId,
          requestId,
        );
        if (startedNative) {
          usePlayerStore.getState().clearAutoPlayFlag();
          return;
        }
        if (isStalePlaybackRequest(requestId, readyAudioUrl)) {
          return;
        }

        setWaveSurferMutedState(false);
        wavesurfer.seekTo(0);
        wavesurfer
          .play()
          .then(() => {
            usePlayerStore.getState().clearAutoPlayFlag();
          })
          .catch((err) => {
            debug.error('Failed to autoplay:', err);
            setIsPlaying(false);
            setError(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
          });
      });

      register('play', () => {
        setIsPlaying(true);
        if (isUsingNativePlaybackRef.current) {
          setWaveSurferMutedState(true);
        } else {
          setWaveSurferMutedState(false);
        }
      });

      register('pause', () => {
        setIsPlaying(false);
      });

      register('finish', () => {
        const wavesurfer = wavesurferRef.current;
        if (!wavesurfer) return;

        if (usePlayerStore.getState().isLooping) {
          wavesurfer.seekTo(0);
          wavesurfer.play();
          return;
        }

        setIsPlaying(false);
        const onFinish = usePlayerStore.getState().onFinish;
        if (onFinish) {
          onFinish();
        }
      });

      register('loading', (percent: number) => {
        if (percent < 100) {
          setIsLoading(true);
        }
      });

      register('error', (wsError: unknown) => {
        setIsLoading(false);
        setError(`Audio error: ${wsError instanceof Error ? wsError.message : String(wsError)}`);
      });
    };

    initRaf1Ref.current = requestAnimationFrame(() => {
      initRaf2Ref.current = requestAnimationFrame(() => {
        initTimeoutRef.current = window.setTimeout(initWaveSurfer, 10);
      });
    });
  }, [
    audioUrl,
    isStalePlaybackRequest,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setWaveSurferMutedState,
    tryStartNativePlaybackForTrack,
  ]);

  // Cleanup once on unmount.
  useEffect(() => {
    return () => {
      isInitializingRef.current = false;
      if (initRaf1Ref.current !== null) {
        cancelAnimationFrame(initRaf1Ref.current);
      }
      if (initRaf2Ref.current !== null) {
        cancelAnimationFrame(initRaf2Ref.current);
      }
      if (initTimeoutRef.current !== null) {
        clearTimeout(initTimeoutRef.current);
      }

      loadRequestRef.current += 1;
      nativePlaybackRequestRef.current += 1;
      stopNativePlayback();
      activeAudioUrlRef.current = null;
      subscriptionsRef.current.forEach((unsubscribe) => {
        unsubscribe();
      });
      subscriptionsRef.current = [];

      const wavesurfer = wavesurferRef.current;
      if (wavesurfer) {
        try {
          const bridge = wavesurfer as unknown as WaveSurferEventBridge;
          bridge.unAll?.();
          const mediaElement = wavesurfer.getMediaElement();
          if (mediaElement) {
            mediaElement.pause();
            mediaElement.src = '';
          }
          wavesurfer.destroy();
        } catch (err) {
          debug.error('Error destroying WaveSurfer:', err);
        }
      }
      wavesurferRef.current = null;
      setIsWaveSurferReady(false);
    };
  }, [stopNativePlayback]);

  // Load audio when URL changes.
  useEffect(() => {
    const wavesurfer = wavesurferRef.current;
    if (!isWaveSurferReady || !wavesurfer) {
      return;
    }

    const loadRequestId = ++loadRequestRef.current;
    nativePlaybackRequestRef.current += 1;
    stopNativePlayback();

    if (!audioUrl) {
      activeAudioUrlRef.current = null;
      try {
        wavesurfer.pause();
        wavesurfer.seekTo(0);
        wavesurfer.empty();
      } catch (err) {
        debug.error('Failed to clear waveform on empty audio:', err);
      }
      setCurrentTime(0);
      setDuration(0);
      setIsLoading(false);
      setError(null);
      return;
    }

    activeAudioUrlRef.current = audioUrl;
    try {
      if (wavesurfer.isPlaying()) {
        wavesurfer.pause();
      }
      wavesurfer.seekTo(0);
    } catch (err) {
      debug.error('Failed to reset waveform before loading new audio:', err);
    }

    setWaveSurferMutedState(false);
    setCurrentTime(0);
    setDuration(0);
    setIsLoading(true);
    setError(null);

    wavesurfer
      .load(audioUrl)
      .then(() => {
        if (loadRequestId !== loadRequestRef.current) {
          return;
        }
        debug.log('Audio load completed:', audioUrl);
      })
      .catch((err) => {
        if (loadRequestId !== loadRequestRef.current) {
          return;
        }
        setIsLoading(false);
        setError(`Failed to load audio: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [
    audioUrl,
    isWaveSurferReady,
    setCurrentTime,
    setDuration,
    setWaveSurferMutedState,
    stopNativePlayback,
  ]);

  // Sync play/pause state from store.
  useEffect(() => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer || duration === 0) return;

    if (isPlaying && !wavesurfer.isPlaying()) {
      wavesurfer.play().catch((err) => {
        debug.error('Failed to play:', err);
        setIsPlaying(false);
        setError(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }

    if (!isPlaying && wavesurfer.isPlaying()) {
      wavesurfer.pause();
    }
  }, [duration, isPlaying, setIsPlaying]);

  // Sync volume.
  useEffect(() => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer) return;

    wavesurfer.setVolume(volume);
    if (isUsingNativePlaybackRef.current) {
      setWaveSurferMutedState(true);
      return;
    }
    setWaveSurferMutedState(false);
  }, [volume, setWaveSurferMutedState]);

  // Restart current track when requested.
  useEffect(() => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer || !shouldRestart || duration === 0) {
      return;
    }

    const runRestart = async () => {
      const currentAudioUrl = usePlayerStore.getState().audioUrl;
      const currentProfileId = usePlayerStore.getState().profileId;
      if (!currentAudioUrl) {
        return;
      }

      wavesurfer.seekTo(0);

      const requestId = ++nativePlaybackRequestRef.current;
      stopNativePlayback();

      if (useNativePlayback) {
        const startedNative = await tryStartNativePlaybackForTrack(
          currentAudioUrl,
          currentProfileId,
          requestId,
        );
        if (startedNative || isStalePlaybackRequest(requestId, currentAudioUrl)) {
          return;
        }
      }

      setWaveSurferMutedState(false);
      wavesurfer.play().catch((err) => {
        debug.error('Failed to play after restart:', err);
        setIsPlaying(false);
        setError(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
      });
    };

    void runRestart().finally(() => {
      clearRestartFlag();
    });
  }, [
    clearRestartFlag,
    duration,
    isStalePlaybackRequest,
    setIsPlaying,
    setWaveSurferMutedState,
    shouldRestart,
    stopNativePlayback,
    tryStartNativePlaybackForTrack,
    useNativePlayback,
  ]);

  const handlePlayPause = async () => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer) {
      setError('Audio player is not initialized yet.');
      return;
    }
    if (duration === 0 && !isLoading) {
      setError('Audio not loaded. Please wait...');
      return;
    }

    if (isPlaying) {
      nativePlaybackRequestRef.current += 1;
      stopNativePlayback();
      wavesurfer.pause();
      setIsPlaying(false);
      return;
    }

    const currentAudioUrl = usePlayerStore.getState().audioUrl;
    const currentProfileId = usePlayerStore.getState().profileId;
    if (currentAudioUrl && useNativePlayback) {
      const requestId = ++nativePlaybackRequestRef.current;
      const startedNative = await tryStartNativePlaybackForTrack(
        currentAudioUrl,
        currentProfileId,
        requestId,
      );
      if (startedNative) {
        return;
      }
    }

    setWaveSurferMutedState(false);
    wavesurfer.play().catch((err) => {
      debug.error('Failed to play:', err);
      setIsPlaying(false);
      setError(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const handleSeek = (value: number[]) => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer || duration === 0) return;
    wavesurfer.seekTo(value[0] / 100);
  };

  const handleVolumeChange = (value: number[]) => {
    setVolume(value[0] / 100);
  };

  const handleClose = () => {
    nativePlaybackRequestRef.current += 1;
    stopNativePlayback();
    activeAudioUrlRef.current = null;

    const wavesurfer = wavesurferRef.current;
    if (wavesurfer) {
      wavesurfer.pause();
      wavesurfer.seekTo(0);
    }
    reset();
  };

  if (!audioUrl) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 z-50">
      <div className="container mx-auto px-4 py-3 max-w-7xl">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePlayPause}
            disabled={isLoading || duration === 0}
            className="shrink-0"
            title={duration === 0 && !isLoading ? 'Audio not loaded' : ''}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>

          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div ref={waveformRef} className="w-full min-h-[80px]" />
            {duration > 0 && (
              <Slider
                value={duration > 0 ? [(currentTime / duration) * 100] : [0]}
                onValueChange={handleSeek}
                max={100}
                step={0.1}
                className="w-full"
              />
            )}
            {isLoading && (
              <div className="text-xs text-muted-foreground text-center py-2">Loading audio...</div>
            )}
            {error && <div className="text-xs text-destructive text-center py-2">{error}</div>}
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0 min-w-[100px]">
            <span className="font-mono">{formatAudioDuration(currentTime)}</span>
            <span>/</span>
            <span className="font-mono">{formatAudioDuration(duration)}</span>
          </div>

          {title && (
            <div className="text-sm font-medium truncate max-w-[200px] shrink-0">{title}</div>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleLoop}
            className={isLooping ? 'text-primary' : ''}
            title="Toggle loop"
          >
            <Repeat className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-2 shrink-0 w-[120px]">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setVolume(volume > 0 ? 0 : 1)}
              className="h-8 w-8"
            >
              {volume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            <Slider
              value={[volume * 100]}
              onValueChange={handleVolumeChange}
              max={100}
              step={1}
              className="flex-1"
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="shrink-0"
            title="Close player"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
