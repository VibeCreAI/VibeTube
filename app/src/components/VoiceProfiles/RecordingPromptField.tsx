import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type LanguageCode, SUPPORTED_LANGUAGES } from '@/lib/constants/languages';
import { getVoiceSampleScript, type RecordingPromptMode } from '@/lib/constants/voiceSampleScripts';

interface RecordingPromptFieldProps {
  language: LanguageCode;
  mode: RecordingPromptMode;
  onModeChange: (mode: RecordingPromptMode) => void;
}

export function RecordingPromptField({ language, mode, onModeChange }: RecordingPromptFieldProps) {
  return (
    <div className="space-y-3 rounded-lg border bg-card/40 p-4">
      <div className="space-y-1">
        <Label>Recording Mode</Label>
        <p className="text-xs text-muted-foreground">
          Use the built-in script to skip transcription, or switch to custom recording and supply
          your own reference text.
        </p>
      </div>
      <Tabs value={mode} onValueChange={(value) => onModeChange(value as RecordingPromptMode)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="script">Sample Script</TabsTrigger>
          <TabsTrigger value="custom">Custom Recording</TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === 'script' ? (
        <div className="space-y-2 rounded-md border bg-background/80 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">{SUPPORTED_LANGUAGES[language]} story prompt</p>
            <span className="text-xs text-muted-foreground">
              Target length: about 30-35 seconds
            </span>
          </div>
          <p className="text-sm leading-6">{getVoiceSampleScript(language)}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Record any clean sample you want. You can type the exact reference text manually or use
          transcription after recording.
        </p>
      )}
    </div>
  );
}
