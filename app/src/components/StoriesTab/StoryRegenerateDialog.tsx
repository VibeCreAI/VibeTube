import { Loader2, Mic, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type {
  StoryItemDetail,
  StoryItemRegenerateRequest,
  VoiceProfileResponse,
} from '@/lib/api/types';
import { type LanguageCode } from '@/lib/constants/languages';
import {
  engineSupportsInstruct,
  getGenerationModelOptions,
  getGenerationModelSelection,
  getLanguageOptionsForEngine,
  getModelSelectionFromName,
  getEffectiveModelSize,
  type TTSEngine,
} from '@/lib/constants/tts';
import { StoryVoiceRecordingForm } from './StoryVoiceRecordingForm';

interface StoryRegenerateDialogProps {
  open: boolean;
  item: StoryItemDetail | null;
  profiles: VoiceProfileResponse[];
  isSubmitting: boolean;
  statusMessage?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: StoryItemRegenerateRequest) => void;
  onSubmitRecorded: (payload: {
    file: File;
    profileId: string;
    language: LanguageCode;
    text: string;
  }) => Promise<void>;
}

interface FormState {
  profileId: string;
  text: string;
  language: LanguageCode;
  engine: TTSEngine;
  modelSize: '1.7B' | '0.6B' | 'default';
  seed: string;
  instruct: string;
}

function buildFormState(item: StoryItemDetail | null): FormState {
  const engine = item?.engine || 'qwen';
  const language = (item?.language as LanguageCode) || 'en';
  const selection = getGenerationModelSelection(language, {
    engine,
    modelSize: getEffectiveModelSize(engine, item?.model_size),
  });
  return {
    profileId: item?.profile_id || '',
    text: item?.text || '',
    language,
    engine: selection.engine,
    modelSize: selection.modelSize,
    seed: '',
    instruct: item?.instruct || '',
  };
}

export function StoryRegenerateDialog({
  open,
  item,
  profiles,
  isSubmitting,
  statusMessage,
  onOpenChange,
  onSubmit,
  onSubmitRecorded,
}: StoryRegenerateDialogProps) {
  const [formState, setFormState] = useState<FormState>(() => buildFormState(item));
  const [mode, setMode] = useState<'generate' | 'record'>('generate');
  const selectedProfile = profiles.find((profile) => profile.id === formState.profileId);
  const selectedModel = getGenerationModelSelection(formState.language, {
    engine: formState.engine,
    modelSize: formState.modelSize,
  });
  const languageOptions = getLanguageOptionsForEngine(selectedModel.engine);
  const modelOptions = getGenerationModelOptions(formState.language);
  const supportsInstruct = engineSupportsInstruct(selectedModel.engine);

  useEffect(() => {
    if (open) {
      setFormState(buildFormState(item));
      setMode('generate');
    }
  }, [open, item]);

  useEffect(() => {
    if (!open || !selectedProfile?.language) {
      return;
    }
    const nextLanguage = selectedProfile.language as LanguageCode;
    const nextModel = getGenerationModelSelection(nextLanguage, {
      engine: formState.engine,
      modelSize: formState.modelSize,
    });
    setFormState((prev) => ({
      ...prev,
      language: nextLanguage,
      engine: nextModel.engine,
      modelSize: nextModel.modelSize,
    }));
  }, [formState.engine, formState.modelSize, open, selectedProfile?.id, selectedProfile?.language]);

  useEffect(() => {
    const nextModel = getGenerationModelSelection(formState.language, {
      engine: formState.engine,
      modelSize: formState.modelSize,
    });
    if (nextModel.engine === formState.engine && nextModel.modelSize === formState.modelSize) {
      return;
    }
    setFormState((prev) => ({
      ...prev,
      engine: nextModel.engine,
      modelSize: nextModel.modelSize,
    }));
  }, [formState.engine, formState.language, formState.modelSize]);

  const handleSubmit = () => {
    const nextModel = getGenerationModelSelection(formState.language, {
      engine: formState.engine,
      modelSize: formState.modelSize,
    });
    onSubmit({
      profile_id: formState.profileId,
      text: formState.text.trim(),
      language: formState.language,
      engine: nextModel.engine,
      model_size: nextModel.modelSize,
      seed: formState.seed.trim() ? Number(formState.seed) : undefined,
      instruct: engineSupportsInstruct(nextModel.engine) ? formState.instruct.trim() || undefined : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Regenerate Clip</DialogTitle>
          <DialogDescription>
            Replace this story item in the same position with either a new generated line or a fresh microphone recording.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={mode} onValueChange={(value) => setMode(value as 'generate' | 'record')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="generate">Generate</TabsTrigger>
              <TabsTrigger value="record">
                <Mic className="mr-2 h-4 w-4" />
                Record Voice
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {mode === 'generate' ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Voice</Label>
                  <Select
                    value={formState.profileId}
                    onValueChange={(value) =>
                      setFormState((prev) => ({ ...prev, profileId: value }))
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a voice" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Language</Label>
                  <Select
                    value={formState.language}
                    onValueChange={(value: LanguageCode) => {
                      const nextModel = getGenerationModelSelection(value, {
                        engine: formState.engine,
                        modelSize: formState.modelSize,
                      });
                      setFormState((prev) => ({
                        ...prev,
                        language: value,
                        engine: nextModel.engine,
                        modelSize: nextModel.modelSize,
                      }));
                    }}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {languageOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Model</Label>
                  <Select
                    value={selectedModel.modelName}
                    onValueChange={(value) => {
                      const nextModel = getModelSelectionFromName(value);
                      setFormState((prev) => ({
                        ...prev,
                        engine: nextModel.engine,
                        modelSize: nextModel.modelSize,
                      }));
                    }}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map((option) => (
                        <SelectItem key={option.modelName} value={option.modelName}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Text</Label>
                <Textarea
                  value={formState.text}
                  onChange={(e) => setFormState((prev) => ({ ...prev, text: e.target.value }))}
                  disabled={isSubmitting}
                  className="min-h-28"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Seed</Label>
                  <Input
                    value={formState.seed}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        seed: e.target.value.replace(/[^0-9]/g, ''),
                      }))
                    }
                    disabled={isSubmitting}
                    placeholder="Blank = new variation"
                  />
                </div>

                <div className="flex items-end">
                  {isSubmitting ? (
                    <div className="flex w-full items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-accent/30">
                        <Loader2 className="h-5 w-5 animate-spin text-accent" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Replacing clip...</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {statusMessage || 'Generating updated audio'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      The new clip will stay in the same story slot.
                    </div>
                  )}
                </div>
              </div>

              {supportsInstruct && (
                <div className="space-y-2">
                  <Label>Instructions</Label>
                  <Textarea
                    value={formState.instruct}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, instruct: e.target.value }))
                    }
                    disabled={isSubmitting}
                    className="min-h-20"
                    placeholder="Optional delivery instructions"
                  />
                </div>
              )}
            </>
          ) : (
            <StoryVoiceRecordingForm
              profiles={profiles}
              initialProfileId={item?.profile_id}
              initialLanguage={(item?.language as LanguageCode) || 'en'}
              initialText={item?.text || ''}
              isSubmitting={isSubmitting}
              submitLabel="Replace with Recording"
              submittingLabel="Replacing..."
              resetKey={`${item?.id ?? 'none'}:${open}:${mode}`}
              onSubmit={onSubmitRecorded}
            />
          )}
        </div>

        {mode === 'generate' && (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !formState.profileId || !formState.text.trim()}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Regenerating...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate
                </>
              )}
            </Button>
          </DialogFooter>
        )}
        {mode === 'record' && (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
