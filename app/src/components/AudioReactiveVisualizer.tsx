import { memo, useEffect, useState } from 'react';
import { Visualizer } from 'react-sound-visualizer';
import { cn } from '@/lib/utils/cn';

const DEFAULT_STROKE_COLOR = '#b39a3d';

const MemoizedWaveform = memo(function MemoizedWaveform({
  audioStream,
  strokeColor,
  canvasClassName,
}: {
  audioStream: MediaStream;
  strokeColor: string;
  canvasClassName?: string;
}) {
  return (
    <Visualizer audio={audioStream} autoStart strokeColor={strokeColor}>
      {({ canvasRef }) => (
        <canvas ref={canvasRef} width={500} height={150} className={canvasClassName || 'w-full h-full'} />
      )}
    </Visualizer>
  );
});

interface AudioReactiveVisualizerProps {
  stream?: MediaStream | null;
  autoCapture?: boolean;
  className?: string;
  canvasClassName?: string;
  strokeColor?: string;
}

export function AudioReactiveVisualizer({
  stream = null,
  autoCapture = false,
  className,
  canvasClassName,
  strokeColor = DEFAULT_STROKE_COLOR,
}: AudioReactiveVisualizerProps) {
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!autoCapture || stream || !navigator.mediaDevices?.getUserMedia) {
      return;
    }

    let disposed = false;
    let localStream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((nextStream) => {
        if (disposed) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStream = nextStream;
        setPreviewStream(nextStream);
      })
      .catch((err) => {
        console.warn('Could not access microphone for visualization:', err);
      });

    return () => {
      disposed = true;
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      setPreviewStream((current) => (current === localStream ? null : current));
    };
  }, [autoCapture, stream]);

  const activeStream = stream ?? previewStream;

  if (!activeStream) {
    return null;
  }

  return (
    <div
      className={cn(
        'absolute inset-0 pointer-events-none flex items-center justify-center opacity-30',
        className,
      )}
    >
      <MemoizedWaveform
        audioStream={activeStream}
        strokeColor={strokeColor}
        canvasClassName={canvasClassName}
      />
    </div>
  );
}
