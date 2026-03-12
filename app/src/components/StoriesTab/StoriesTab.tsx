import { useEffect, useRef, useState } from 'react';
import { useStory } from '@/lib/hooks/useStories';
import { cn } from '@/lib/utils/cn';
import { useStoryStore } from '@/stores/storyStore';
import { StoryBatchCreateDialog } from './StoryBatchCreateDialog';
import { StoryContent } from './StoryContent';
import { StoryList } from './StoryList';

export function StoriesTab() {
  const SPLITTER_STORAGE_KEY = 'vibetube.stories.leftPaneWidth';
  const MIN_LEFT_PANE_WIDTH = 320;
  const MIN_RIGHT_PANE_WIDTH = 520;
  const SPLITTER_WIDTH = 12;
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedStoryId = useStoryStore((state) => state.selectedStoryId);
  const trackEditorHeight = useStoryStore((state) => state.trackEditorHeight);
  const { data: story } = useStory(selectedStoryId);
  const hasBottomBar = !!story && story.items.length > 0;
  const bottomPadding = hasBottomBar ? trackEditorHeight + 24 : 0;
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  );
  const [leftPaneWidth, setLeftPaneWidth] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateDesktopState = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };

    updateDesktopState();
    window.addEventListener('resize', updateDesktopState);
    return () => window.removeEventListener('resize', updateDesktopState);
  }, []);

  useEffect(() => {
    if (!isDesktop || typeof window === 'undefined') {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const clampWidth = (nextWidth: number, containerWidth: number) => {
      const maxLeftWidth = Math.max(
        MIN_LEFT_PANE_WIDTH,
        containerWidth - MIN_RIGHT_PANE_WIDTH - SPLITTER_WIDTH,
      );
      return Math.min(Math.max(nextWidth, MIN_LEFT_PANE_WIDTH), maxLeftWidth);
    };

    const updateLayoutWidth = () => {
      const containerWidth = container.clientWidth;
      if (containerWidth <= 0) {
        return;
      }

      setLeftPaneWidth((prev) => {
        const storedRaw = window.localStorage.getItem(SPLITTER_STORAGE_KEY);
        const storedWidth = storedRaw ? Number(storedRaw) : Number.NaN;
        const fallbackWidth = Math.min(360, Math.round((containerWidth - SPLITTER_WIDTH) * 0.32));
        const nextWidth = clampWidth(
          prev ?? (Number.isFinite(storedWidth) ? storedWidth : fallbackWidth),
          containerWidth,
        );

        if (nextWidth !== prev) {
          window.localStorage.setItem(SPLITTER_STORAGE_KEY, String(nextWidth));
        }

        return nextWidth;
      });
    };

    updateLayoutWidth();

    const resizeObserver = new ResizeObserver(() => {
      updateLayoutWidth();
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop || leftPaneWidth == null || typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(SPLITTER_STORAGE_KEY, String(leftPaneWidth));
  }, [isDesktop, leftPaneWidth]);

  const handleSplitterMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isDesktop || !containerRef.current) {
      return;
    }

    event.preventDefault();

    const containerRect = containerRef.current.getBoundingClientRect();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const containerWidth = containerRef.current?.clientWidth ?? containerRect.width;
      const pointerOffset = moveEvent.clientX - containerRect.left;
      const maxLeftWidth = Math.max(
        MIN_LEFT_PANE_WIDTH,
        containerWidth - MIN_RIGHT_PANE_WIDTH - SPLITTER_WIDTH,
      );
      const nextWidth = Math.min(Math.max(pointerOffset, MIN_LEFT_PANE_WIDTH), maxLeftWidth);
      setLeftPaneWidth(nextWidth);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Main content area */}
      <div
        ref={containerRef}
        className={cn(
          'flex-1 min-h-0 overflow-hidden relative',
          isDesktop ? 'grid gap-0' : 'flex flex-col gap-6',
        )}
        style={
          isDesktop && leftPaneWidth != null
            ? { gridTemplateColumns: `${leftPaneWidth}px ${SPLITTER_WIDTH}px minmax(0, 1fr)` }
            : undefined
        }
      >
        {/* Left Column - Story List */}
        <div
          className={cn(
            'flex flex-col min-h-0 overflow-hidden',
            isDesktop ? 'w-full shrink-0 pr-3' : 'w-full max-w-[360px] shrink-0',
          )}
          style={{ paddingBottom: bottomPadding > 0 ? `${bottomPadding}px` : undefined }}
        >
          <StoryList onOpenBatchCreate={() => setBatchDialogOpen(true)} />
        </div>

        {isDesktop && (
          <div
            className="relative flex min-h-0 items-stretch justify-center cursor-col-resize select-none"
            onMouseDown={handleSplitterMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize story panels"
          >
            <div className="h-full w-px bg-border/70" />
            <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
          </div>
        )}

        {/* Right Column - Story Content */}
        <div className={cn('flex flex-col min-h-0 overflow-hidden flex-1', isDesktop && 'pl-3')}>
          <StoryContent />
        </div>
      </div>
      <StoryBatchCreateDialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen} />
    </div>
  );
}
