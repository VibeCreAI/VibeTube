import { Sparkles, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FloatingGenerateBox } from '@/components/Generation/FloatingGenerateBox';
import { HistoryTable } from '@/components/History/HistoryTable';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { ProfileList } from '@/components/VoiceProfiles/ProfileList';
import { BOTTOM_SAFE_AREA_PADDING } from '@/lib/constants/ui';
import { useImportProfile } from '@/lib/hooks/useProfiles';
import { cn } from '@/lib/utils/cn';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';

export function MainEditor() {
  const SPLITTER_STORAGE_KEY = 'vibetube.mainEditor.leftPaneWidth';
  const MIN_LEFT_PANE_WIDTH = 420;
  const MIN_RIGHT_PANE_WIDTH = 420;
  const SPLITTER_WIDTH = 12;
  const audioUrl = usePlayerStore((state) => state.audioUrl);
  const isPlayerVisible = !!audioUrl;
  const containerRef = useRef<HTMLDivElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const setDialogOpen = useUIStore((state) => state.setProfileDialogOpen);
  const importProfile = useImportProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  );
  const [leftPaneWidth, setLeftPaneWidth] = useState<number | null>(null);
  const [floatingBoxMetrics, setFloatingBoxMetrics] = useState<{ left: number; width: number } | null>(
    null,
  );
  const { toast } = useToast();

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

    const updateLayoutMetrics = () => {
      const containerWidth = container.clientWidth;
      if (containerWidth <= 0) {
        return;
      }

      setLeftPaneWidth((prev) => {
        const storedRaw = window.localStorage.getItem(SPLITTER_STORAGE_KEY);
        const storedWidth = storedRaw ? Number(storedRaw) : Number.NaN;
        const fallbackWidth = Math.round((containerWidth - SPLITTER_WIDTH) * 0.5);
        const nextWidth = clampWidth(
          prev ?? (Number.isFinite(storedWidth) ? storedWidth : fallbackWidth),
          containerWidth,
        );

        if (nextWidth !== prev) {
          window.localStorage.setItem(SPLITTER_STORAGE_KEY, String(nextWidth));
        }

        return nextWidth;
      });

      if (leftColumnRef.current) {
        const rect = leftColumnRef.current.getBoundingClientRect();
        setFloatingBoxMetrics({
          left: rect.left,
          width: rect.width,
        });
      }
    };

    updateLayoutMetrics();

    const resizeObserver = new ResizeObserver(() => {
      updateLayoutMetrics();
    });

    resizeObserver.observe(container);
    if (leftColumnRef.current) {
      resizeObserver.observe(leftColumnRef.current);
    }

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

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.vibetube.zip')) {
        toast({
          title: 'Invalid file type',
          description: 'Please select a valid .vibetube.zip file',
          variant: 'destructive',
        });
        return;
      }
      setSelectedFile(file);
      setImportDialogOpen(true);
    }
  };

  const handleImportConfirm = () => {
    if (selectedFile) {
      importProfile.mutate(selectedFile, {
        onSuccess: () => {
          setImportDialogOpen(false);
          setSelectedFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          toast({
            title: 'Profile imported',
            description: 'Voice profile imported successfully',
          });
        },
        onError: (error) => {
          toast({
            title: 'Failed to import profile',
            description: error.message,
            variant: 'destructive',
          });
        },
      });
    }
  };

  return (
    // Main view: Profiles top left, Generator bottom left, History right
    <div
      ref={containerRef}
      className={cn(
        'h-full min-h-0 overflow-hidden relative',
        isDesktop ? 'grid gap-0' : 'grid grid-cols-1 gap-6',
      )}
      style={
        isDesktop && leftPaneWidth != null
          ? { gridTemplateColumns: `${leftPaneWidth}px ${SPLITTER_WIDTH}px minmax(0, 1fr)` }
          : undefined
      }
    >
      {/* Left Column */}
      <div ref={leftColumnRef} className="flex flex-col min-h-0 overflow-hidden relative pr-3">
        {/* Scroll Mask - Always visible, behind content */}
        <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-background to-transparent z-0 pointer-events-none" />

        {/* Fixed Header */}
        <div className="absolute top-0 left-0 right-0 z-10">
          <div className="flex items-center justify-between mb-4 px-1">
            <h2 className="text-2xl font-bold">VibeTube</h2>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleImportClick}>
                <Upload className="mr-2 h-4 w-4" />
                Import Profile
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".vibetube.zip"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button onClick={() => setDialogOpen(true)}>
                <Sparkles className="mr-2 h-4 w-4" />
                Create Profile
              </Button>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div
          ref={scrollRef}
          className={cn(
            'flex-1 min-h-0 overflow-y-auto pt-14',
            isPlayerVisible ? BOTTOM_SAFE_AREA_PADDING : 'pb-4',
          )}
        >
          <div className="flex flex-col gap-6">
            <div className="shrink-0 flex flex-col">
              <ProfileList />
            </div>
          </div>
        </div>
      </div>

      {isDesktop && (
        <div
          className="relative flex min-h-0 items-stretch justify-center cursor-col-resize select-none"
          onMouseDown={handleSplitterMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
        >
          <div className="h-full w-px bg-border/70" />
          <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
        </div>
      )}

      {/* Right Column - History */}
      <div className="flex flex-col min-h-0 overflow-hidden pl-3">
        <HistoryTable />
      </div>

      {/* Floating Generate Box */}
      <FloatingGenerateBox
        isPlayerOpen={!!audioUrl}
        desktopMetrics={isDesktop ? floatingBoxMetrics : null}
      />

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Profile</DialogTitle>
            <DialogDescription>
              Import the profile from "{selectedFile?.name}". This will create a new profile with
              all samples.
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
              disabled={importProfile.isPending || !selectedFile}
            >
              {importProfile.isPending ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
