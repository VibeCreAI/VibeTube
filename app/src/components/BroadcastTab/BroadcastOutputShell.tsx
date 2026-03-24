import { getCurrentWindow, type ResizeDirection } from '@tauri-apps/api/window';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BroadcastStage } from '@/components/BroadcastTab/BroadcastStage';
import {
  BROADCAST_CHANNEL_NAME,
  BROADCAST_CONTROL_CHANNEL_NAME,
  type BroadcastStageState,
  createIdleBroadcastStageState,
  readBroadcastSnapshot,
} from '@/lib/utils/broadcastSession';

interface ResizeHandleConfig {
  direction: ResizeDirection;
  className: string;
  cursorClassName: string;
  ariaLabel: string;
}

const RESIZE_HANDLES: ResizeHandleConfig[] = [
  {
    direction: 'North',
    className: 'left-3 right-3 top-0 h-3',
    cursorClassName: 'cursor-n-resize',
    ariaLabel: 'Resize from top edge',
  },
  {
    direction: 'South',
    className: 'bottom-0 left-3 right-3 h-3',
    cursorClassName: 'cursor-s-resize',
    ariaLabel: 'Resize from bottom edge',
  },
  {
    direction: 'West',
    className: 'bottom-3 left-0 top-3 w-3',
    cursorClassName: 'cursor-w-resize',
    ariaLabel: 'Resize from left edge',
  },
  {
    direction: 'East',
    className: 'bottom-3 right-0 top-3 w-3',
    cursorClassName: 'cursor-e-resize',
    ariaLabel: 'Resize from right edge',
  },
  {
    direction: 'NorthWest',
    className: 'left-0 top-0 h-4 w-4',
    cursorClassName: 'cursor-nw-resize',
    ariaLabel: 'Resize from top-left corner',
  },
  {
    direction: 'NorthEast',
    className: 'right-0 top-0 h-4 w-4',
    cursorClassName: 'cursor-ne-resize',
    ariaLabel: 'Resize from top-right corner',
  },
  {
    direction: 'SouthWest',
    className: 'bottom-0 left-0 h-4 w-4',
    cursorClassName: 'cursor-sw-resize',
    ariaLabel: 'Resize from bottom-left corner',
  },
  {
    direction: 'SouthEast',
    className: 'bottom-0 right-0 h-4 w-4',
    cursorClassName: 'cursor-se-resize',
    ariaLabel: 'Resize from bottom-right corner',
  },
];

export function BroadcastOutputShell() {
  const [stageState, setStageState] = useState<BroadcastStageState>(() => {
    return (
      readBroadcastSnapshot() ??
      createIdleBroadcastStageState(
        {
          idleUrl: null,
          talkUrl: null,
          idleBlinkUrl: null,
          talkBlinkUrl: null,
        },
        null,
        null,
        false,
      )
    );
  });
  const [isHighlighted, setIsHighlighted] = useState(false);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const previousHtmlBackground = document.documentElement.style.background;
    const previousBodyBackground = document.body.style.background;

    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';

    const snapshot = readBroadcastSnapshot();
    if (snapshot) {
      setStageState(snapshot);
    }

    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<BroadcastStageState>) => {
      setStageState(event.data);
    };

    const controlChannel = new BroadcastChannel(BROADCAST_CONTROL_CHANNEL_NAME);
    controlChannel.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type !== 'highlight') {
        return;
      }

      setIsHighlighted(false);
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      window.requestAnimationFrame(() => {
        setIsHighlighted(true);
      });
      highlightTimerRef.current = window.setTimeout(() => {
        setIsHighlighted(false);
        highlightTimerRef.current = null;
      }, 2200);
    };

    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      setIsHighlighted(false);
      controlChannel.close();
      channel.close();
      document.documentElement.style.background = previousHtmlBackground;
      document.body.style.background = previousBodyBackground;
    };
  }, []);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    void getCurrentWindow()
      .startDragging()
      .catch(() => {
        // Ignore drag failures outside Tauri.
      });
  }, []);

  const handleResizeMouseDown = useCallback(
    (direction: ResizeDirection, event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void getCurrentWindow()
        .startResizeDragging(direction)
        .catch(() => {
          // Ignore resize drag failures outside Tauri.
        });
    },
    [],
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-transparent">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Move output window"
        data-tauri-drag-region
        className="fixed inset-0 z-10 cursor-move appearance-none border-0 bg-transparent p-0"
        onMouseDown={handleMouseDown}
      />
      {RESIZE_HANDLES.map((handle) => (
        <button
          type="button"
          key={handle.direction}
          tabIndex={-1}
          aria-label={handle.ariaLabel}
          className={`pointer-events-auto absolute z-30 appearance-none border-0 bg-transparent p-0 ${handle.className} ${handle.cursorClassName}`}
          onMouseDown={(event) => handleResizeMouseDown(handle.direction, event)}
        />
      ))}
      {isHighlighted ? (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-[28px] border-[8px] border-cyan-300 bg-[rgba(8,145,178,0.28)] shadow-[0_0_0_4px_rgba(34,211,238,0.35),0_0_48px_rgba(34,211,238,0.85)]"
            style={{
              animation: 'broadcast-output-highlight-pulse 0.48s ease-in-out 4',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-[18px] rounded-[20px] border-2 border-white/70"
            style={{
              animation: 'broadcast-output-highlight-pulse 0.48s ease-in-out 4',
            }}
          />
          <div
            className="absolute left-6 top-6 rounded-full border border-cyan-200/80 bg-[rgba(8,145,178,0.92)] px-4 py-2 text-sm font-semibold tracking-[0.18em] text-white shadow-[0_10px_24px_rgba(8,145,178,0.45)]"
            style={{
              animation: 'broadcast-output-highlight-label 0.48s ease-in-out 4',
            }}
          >
            OUTPUT HERE
          </div>
        </div>
      ) : null}
      <style>{`
        @keyframes broadcast-output-highlight-pulse {
          0%, 100% {
            opacity: 0.22;
            transform: scale(0.997);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes broadcast-output-highlight-label {
          0%, 100% {
            opacity: 0.38;
            transform: translateY(-2px);
          }
          50% {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <BroadcastStage
        state={stageState}
        transparent
        checkerboard={false}
        showStatus={false}
        showEmptyHint={false}
        className="h-full rounded-none border-0"
      />
    </div>
  );
}
