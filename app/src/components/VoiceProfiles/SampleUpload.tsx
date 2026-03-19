import { zodResolver } from '@hookform/resolvers/zod';
import { Mic, Monitor, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import type { LanguageCode, TranscriptionLanguageCode } from '@/lib/constants/languages';
import { getVoiceSampleScript, type RecordingPromptMode } from '@/lib/constants/voiceSampleScripts';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import type { AudioProcessingOptions } from '@/lib/hooks/useAudioRecording';
import { useAudioRecording } from '@/lib/hooks/useAudioRecording';
import { useAddSample, useProfile } from '@/lib/hooks/useProfiles';
import { useSystemAudioCapture } from '@/lib/hooks/useSystemAudioCapture';
import { useTranscription } from '@/lib/hooks/useTranscription';
import { applyGainToAudioFile } from '@/lib/utils/audio';
import { usePlatform } from '@/platform/PlatformContext';
import { AudioSampleRecording } from './AudioSampleRecording';
import { AudioSampleSystem } from './AudioSampleSystem';
import { AudioSampleUpload } from './AudioSampleUpload';
import { RecordingPromptField } from './RecordingPromptField';
import { TranscriptionLanguageField } from './TranscriptionLanguageField';

const sampleSchema = z.object({
  file: z.instanceof(File, { message: 'Please select an audio file' }),
  referenceText: z
    .string()
    .min(1, 'Reference text is required')
    .max(1000, 'Reference text must be less than 1000 characters'),
});

type SampleFormValues = z.infer<typeof sampleSchema>;

interface SampleUploadProps {
  profileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SampleUpload({ profileId, open, onOpenChange }: SampleUploadProps) {
  const platform = usePlatform();
  const addSample = useAddSample();
  const transcribe = useTranscription();
  const { data: profile } = useProfile(profileId);
  const { toast } = useToast();
  const [mode, setMode] = useState<'upload' | 'record' | 'system'>('upload');
  const [transcriptionLanguage, setTranscriptionLanguage] =
    useState<TranscriptionLanguageCode>('auto');
  const [recordingPromptMode, setRecordingPromptMode] = useState<RecordingPromptMode>('script');
  const [recordGainDb, setRecordGainDb] = useState(0);
  const [audioProcessing, setAudioProcessing] = useState<AudioProcessingOptions>({
    autoGainControl: true,
    noiseSuppression: true,
    echoCancellation: true,
  });
  const { isPlaying, playPause, cleanup: cleanupAudio } = useAudioPlayer();

  const form = useForm<SampleFormValues>({
    resolver: zodResolver(sampleSchema),
    defaultValues: {
      referenceText: '',
    },
  });

  const selectedFile = form.watch('file');
  const recordingLanguage = (profile?.language as LanguageCode) || 'en';
  const shouldShowTranscriptionControls = mode !== 'record' || recordingPromptMode === 'custom';
  const shouldShowReferenceTextField = mode !== 'record' || recordingPromptMode !== 'script';

  const {
    isRecording,
    duration,
    error: recordingError,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useAudioRecording({
    maxDurationSeconds: 29,
    audioProcessing,
    onRecordingComplete: (blob, recordedDuration) => {
      // Convert blob to File object
      const file = new File([blob], `recording-${Date.now()}.webm`, {
        type: blob.type || 'audio/webm',
      }) as File & { recordedDuration?: number };
      // Store the actual recorded duration to bypass metadata reading issues on Windows
      if (recordedDuration !== undefined) {
        file.recordedDuration = recordedDuration;
      }
      form.setValue('file', file, { shouldValidate: true });
      toast({
        title: 'Recording complete',
        description: 'Audio has been recorded successfully.',
      });
    },
  });

  const {
    isRecording: isSystemRecording,
    duration: systemDuration,
    error: systemRecordingError,
    isSupported: isSystemAudioSupported,
    startRecording: startSystemRecording,
    stopRecording: stopSystemRecording,
    cancelRecording: cancelSystemRecording,
  } = useSystemAudioCapture({
    maxDurationSeconds: 29,
    onRecordingComplete: (blob, recordedDuration) => {
      // Convert blob to File object
      const file = new File([blob], `system-audio-${Date.now()}.wav`, {
        type: blob.type || 'audio/wav',
      }) as File & { recordedDuration?: number };
      // Store the actual recorded duration to bypass metadata reading issues on Windows
      if (recordedDuration !== undefined) {
        file.recordedDuration = recordedDuration;
      }
      form.setValue('file', file, { shouldValidate: true });
      toast({
        title: 'System audio captured',
        description: 'Audio has been captured successfully.',
      });
    },
  });

  // Show recording errors
  useEffect(() => {
    if (recordingError) {
      toast({
        title: 'Recording error',
        description: recordingError,
        variant: 'destructive',
      });
    }
  }, [recordingError, toast]);

  // Show system audio recording errors
  useEffect(() => {
    if (systemRecordingError) {
      toast({
        title: 'System audio capture error',
        description: systemRecordingError,
        variant: 'destructive',
      });
    }
  }, [systemRecordingError, toast]);

  useEffect(() => {
    if (mode !== 'record' || recordingPromptMode !== 'script') {
      return;
    }

    form.setValue('referenceText', getVoiceSampleScript(recordingLanguage), {
      shouldValidate: true,
    });
    form.clearErrors('referenceText');
  }, [form, mode, recordingLanguage, recordingPromptMode]);

  useEffect(() => {
    if (mode === 'record' && recordingPromptMode === 'script') {
      return;
    }

    const scriptText = getVoiceSampleScript(recordingLanguage).trim();
    const currentText = (form.getValues('referenceText') || '').trim();

    // When transcription input is visible, start blank instead of carrying
    // over script-mode auto text.
    if (currentText && currentText === scriptText) {
      form.setValue('referenceText', '', { shouldValidate: false, shouldDirty: false });
      form.clearErrors('referenceText');
    }
  }, [form, mode, recordingLanguage, recordingPromptMode]);

  async function handleTranscribe() {
    const file = form.getValues('file');
    if (!file) {
      toast({
        title: 'No file selected',
        description: 'Please select an audio file first.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const result = await transcribe.mutateAsync({ file, language: transcriptionLanguage });

      form.setValue('referenceText', result.text, { shouldValidate: true });
    } catch (error) {
      toast({
        title: 'Transcription failed',
        description: error instanceof Error ? error.message : 'Failed to transcribe audio',
        variant: 'destructive',
      });
    }
  }

  async function onSubmit(data: SampleFormValues) {
    try {
      let fileToUpload = data.file;
      if (mode === 'record' && Math.abs(recordGainDb) > 0.001) {
        fileToUpload = await applyGainToAudioFile(data.file, recordGainDb);
      }

      await addSample.mutateAsync({
        profileId,
        file: fileToUpload,
        referenceText: data.referenceText,
      });

      toast({
        title: 'Sample added',
        description: 'Audio sample has been added successfully.',
      });

      handleOpenChange(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add sample',
        variant: 'destructive',
      });
    }
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      form.reset();
      setMode('upload');
      setTranscriptionLanguage('auto');
      setRecordingPromptMode('script');
      setRecordGainDb(0);
      if (isRecording) {
        cancelRecording();
      }
      if (isSystemRecording) {
        cancelSystemRecording();
      }
      cleanupAudio();
    }
    onOpenChange(newOpen);
  }

  function handleCancelRecording() {
    if (mode === 'record') {
      cancelRecording();
    } else if (mode === 'system') {
      cancelSystemRecording();
    }
    form.resetField('file');
    cleanupAudio();
  }

  function handlePlayPause() {
    const file = form.getValues('file');
    playPause(file);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Audio Sample</DialogTitle>
          <DialogDescription>
            Upload an audio file and provide the transcription that matches the audio.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'upload' | 'record' | 'system')}>
              <TabsList
                className={`grid w-full ${platform.metadata.isTauri && isSystemAudioSupported ? 'grid-cols-3' : 'grid-cols-2'}`}
              >
                <TabsTrigger value="upload" className="flex items-center gap-2">
                  <Upload className="h-4 w-4 shrink-0" />
                  Upload
                </TabsTrigger>
                <TabsTrigger value="record" className="flex items-center gap-2">
                  <Mic className="h-4 w-4 shrink-0" />
                  Record
                </TabsTrigger>
                {platform.metadata.isTauri && isSystemAudioSupported && (
                  <TabsTrigger value="system" className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 shrink-0" />
                    System Audio
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="upload" className="space-y-4">
                <FormField
                  control={form.control}
                  name="file"
                  render={({ field: { onChange, name } }) => (
                    <AudioSampleUpload
                      file={selectedFile}
                      onFileChange={onChange}
                      onTranscribe={handleTranscribe}
                      onPlayPause={handlePlayPause}
                      isPlaying={isPlaying}
                      isTranscribing={transcribe.isPending}
                      fieldName={name}
                    />
                  )}
                />
              </TabsContent>

              <TabsContent value="record" className="space-y-4">
                <RecordingPromptField
                  language={recordingLanguage}
                  mode={recordingPromptMode}
                  onModeChange={setRecordingPromptMode}
                />
                <FormField
                  control={form.control}
                  name="file"
                  render={() => (
                    <AudioSampleRecording
                      file={selectedFile}
                      isRecording={isRecording}
                      duration={duration}
                      audioProcessing={audioProcessing}
                      onAudioProcessingChange={setAudioProcessing}
                      onStart={startRecording}
                      onStop={stopRecording}
                      onCancel={handleCancelRecording}
                      onTranscribe={handleTranscribe}
                      onPlayPause={handlePlayPause}
                      isPlaying={isPlaying}
                      isTranscribing={transcribe.isPending}
                      showTranscribeButton={recordingPromptMode === 'custom'}
                    />
                  )}
                />
                {selectedFile && !isRecording && (
                  <FormItem>
                    <FormLabel>Recorded Sample Gain (dB)</FormLabel>
                    <div className="flex items-center gap-3">
                      <Input
                        type="range"
                        min={-12}
                        max={24}
                        step={1}
                        value={recordGainDb}
                        onChange={(e) => setRecordGainDb(Number(e.target.value))}
                      />
                      <Input
                        type="number"
                        min={-12}
                        max={24}
                        step={1}
                        value={recordGainDb}
                        onChange={(e) => setRecordGainDb(Number(e.target.value))}
                        className="w-20"
                      />
                    </div>
                  </FormItem>
                )}
              </TabsContent>

              {platform.metadata.isTauri && isSystemAudioSupported && (
                <TabsContent value="system" className="space-y-4">
                  <FormField
                    control={form.control}
                    name="file"
                    render={() => (
                      <AudioSampleSystem
                        file={selectedFile}
                        isRecording={isSystemRecording}
                        duration={systemDuration}
                        onStart={startSystemRecording}
                        onStop={stopSystemRecording}
                        onCancel={handleCancelRecording}
                        onTranscribe={handleTranscribe}
                        onPlayPause={handlePlayPause}
                        isPlaying={isPlaying}
                        isTranscribing={transcribe.isPending}
                      />
                    )}
                  />
                </TabsContent>
              )}
            </Tabs>

            {shouldShowTranscriptionControls ? (
              <TranscriptionLanguageField
                value={transcriptionLanguage}
                onChange={setTranscriptionLanguage}
                disabled={transcribe.isPending}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Sample script mode fills the transcription automatically, so transcription is not
                needed.
              </p>
            )}

            {shouldShowReferenceTextField && (
              <FormField
                control={form.control}
                name="referenceText"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Transcription</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter the exact text spoken in the audio..."
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addSample.isPending}>
                {addSample.isPending ? 'Uploading...' : 'Add Sample'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
