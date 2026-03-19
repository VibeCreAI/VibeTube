import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Mic, MoreHorizontal, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import type { StoryItemDetail } from '@/lib/api/types';
import { getGenerationAudioLabel } from '@/lib/constants/tts';
import { cn } from '@/lib/utils/cn';
import { useServerStore } from '@/stores/serverStore';

interface StoryChatItemProps {
  item: StoryItemDetail;
  storyId: string;
  index: number;
  onPlayFromHere: () => void;
  onSelect?: () => void;
  onRemove: () => void;
  onRegenerate: () => void;
  currentTimeMs: number;
  isPlaying: boolean;
  isSelected?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
  isRegenerating?: boolean;
}

export function StoryChatItem({
  item,
  onPlayFromHere,
  onSelect,
  onRemove,
  onRegenerate,
  currentTimeMs,
  isPlaying,
  isSelected = false,
  dragHandleProps,
  isDragging,
  isRegenerating,
}: StoryChatItemProps) {
  const serverUrl = useServerStore((state) => state.serverUrl);
  const [avatarError, setAvatarError] = useState(false);

  const avatarUrl = `${serverUrl}/profiles/${item.profile_id}/avatar`;

  // Check if this item is currently playing based on timecode
  const itemStartMs = item.start_time_ms;
  const itemEndMs =
    item.start_time_ms +
    Math.max(0, item.duration * 1000 - (item.trim_start_ms || 0) - (item.trim_end_ms || 0));
  const isCurrentlyPlaying = isPlaying && currentTimeMs >= itemStartMs && currentTimeMs < itemEndMs;
  // Exclusive highlight behavior:
  // - During playback: highlight only the currently playing item.
  // - When not playing: highlight the manually selected item.
  const isCyanHighlighted = isCurrentlyPlaying || (!isPlaying && isSelected);
  const generationLabel = getGenerationAudioLabel({
    engine: item.engine,
    modelSize: item.model_size,
    sourceType: item.source_type,
  });

  const handlePlay = () => {
    onSelect?.();
    onPlayFromHere();
  };

  const handleRegenerate = () => {
    onSelect?.();
    onRegenerate();
  };

  const handleRemove = () => {
    onSelect?.();
    onRemove();
  };

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 100);
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds}`;
  };

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: Story item card acts as a selectable container while preserving nested controls */
    <div
      className={cn(
        'flex items-start gap-3 p-4 rounded-lg border transition-colors',
        isCyanHighlighted && 'bg-muted/70 border-cyan-400 ring-2 ring-cyan-400/70',
        !isCyanHighlighted && 'hover:bg-muted/50',
        isDragging && 'opacity-50 shadow-lg',
      )}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (!onSelect) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {/* Drag Handle */}
      {dragHandleProps && (
        <button
          type="button"
          className="shrink-0 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground transition-colors"
          {...dragHandleProps}
        >
          <GripVertical className="h-5 w-5" />
        </button>
      )}

      {/* Voice Avatar */}
      <div className="shrink-0">
        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center overflow-hidden">
          {!avatarError ? (
            <img
              src={avatarUrl}
              alt={`${item.profile_name} avatar`}
              className={cn(
                'h-full w-full object-cover transition-all duration-200',
                !isCurrentlyPlaying && 'grayscale',
              )}
              onError={() => setAvatarError(true)}
            />
          ) : (
            <Mic className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-medium text-sm">{item.profile_name}</span>
          <span className="text-xs text-muted-foreground">{item.language}</span>
          <span className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {generationLabel}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums ml-auto">
            {formatTime(itemStartMs)}
          </span>
        </div>
        <Textarea
          value={item.text}
          className="flex-1 resize-none text-sm text-muted-foreground select-text bg-card cursor-text"
          readOnly
          onDoubleClick={handlePlay}
        />
      </div>

      {/* Actions */}
      <div className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handlePlay}>
              <Play className="mr-2 h-4 w-4" />
              Play from here
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRegenerate} disabled={isRegenerating}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {isRegenerating ? 'Regenerating...' : 'Regenerate'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleRemove}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove from Story
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// Sortable wrapper component
export function SortableStoryChatItem(
  props: Omit<StoryChatItemProps, 'dragHandleProps' | 'isDragging'>,
) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.generation_id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <StoryChatItem {...props} dragHandleProps={listeners} isDragging={isDragging} />
    </div>
  );
}
