import { useState } from 'react';
import { useStory } from '@/lib/hooks/useStories';
import { useStoryStore } from '@/stores/storyStore';
import { StoryBatchCreateDialog } from './StoryBatchCreateDialog';
import { StoryContent } from './StoryContent';
import { StoryList } from './StoryList';

export function StoriesTab() {
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const selectedStoryId = useStoryStore((state) => state.selectedStoryId);
  const trackEditorHeight = useStoryStore((state) => state.trackEditorHeight);
  const { data: story } = useStory(selectedStoryId);
  const hasBottomBar = !!story && story.items.length > 0;
  const bottomPadding = hasBottomBar ? trackEditorHeight + 24 : 0;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Main content area */}
      <div className="flex-1 min-h-0 flex gap-6 overflow-hidden relative">
        {/* Left Column - Story List */}
        <div
          className="flex flex-col min-h-0 overflow-hidden w-full max-w-[360px] shrink-0"
          style={{ paddingBottom: bottomPadding > 0 ? `${bottomPadding}px` : undefined }}
        >
          <StoryList onOpenBatchCreate={() => setBatchDialogOpen(true)} />
        </div>

        {/* Right Column - Story Content */}
        <div className="flex flex-col min-h-0 overflow-hidden flex-1">
          <StoryContent />
        </div>
      </div>
      <StoryBatchCreateDialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen} />
    </div>
  );
}
