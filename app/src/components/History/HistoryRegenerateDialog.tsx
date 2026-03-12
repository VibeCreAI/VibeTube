import { Loader2, RefreshCw } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import type { GenerationRequest, HistoryResponse, VoiceProfileResponse } from '@/lib/api/types';
import { LANGUAGE_OPTIONS, type LanguageCode } from '@/lib/constants/languages';

interface HistoryRegenerateDialogProps {
  open: boolean;
  generation: HistoryResponse | null;
  profiles: VoiceProfileResponse[];
  isSubmitting: boolean;
  statusMessage?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: GenerationRequest) => void;
}

interface FormState {
  profileId: string;
  text: string;
  language: LanguageCode;
  modelSize: '1.7B' | '0.6B';
  seed: string;
  instruct: string;
}

function buildFormState(generation: HistoryResponse | null): FormState {
  return {
    profileId: generation?.profile_id || '',
    text: generation?.text || '',
    language: (generation?.language as LanguageCode) || 'en',
    modelSize: '1.7B',
    seed: '',
    instruct: generation?.instruct || '',
  };
}

export function HistoryRegenerateDialog({
  open,
  generation,
  profiles,
  isSubmitting,
  statusMessage,
  onOpenChange,
  onSubmit,
}: HistoryRegenerateDialogProps) {
  const [formState, setFormState] = useState<FormState>(() => buildFormState(generation));
  const selectedProfile = profiles.find((profile) => profile.id === formState.profileId);

  useEffect(() => {
    if (open) {
      setFormState(buildFormState(generation));
    }
  }, [open, generation]);

  useEffect(() => {
    if (!open || !selectedProfile?.language) {
      return;
    }
    setFormState((prev) => ({
      ...prev,
      language: selectedProfile.language as LanguageCode,
    }));
  }, [open, selectedProfile?.id, selectedProfile?.language]);

  const handleSubmit = () => {
    onSubmit({
      profile_id: formState.profileId,
      text: formState.text.trim(),
      language: formState.language,
      model_size: formState.modelSize,
      seed: formState.seed.trim() ? Number(formState.seed) : undefined,
      instruct: formState.instruct.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Regenerate Audio</DialogTitle>
          <DialogDescription>
            Create a new generation from this clip’s current voice and text, or change them before
            regenerating.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Voice</Label>
              <Select
                value={formState.profileId}
                onValueChange={(value) => setFormState((prev) => ({ ...prev, profileId: value }))}
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
                onValueChange={(value: LanguageCode) =>
                  setFormState((prev) => ({ ...prev, language: value }))
                }
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
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

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Model</Label>
              <Select
                value={formState.modelSize}
                onValueChange={(value: '1.7B' | '0.6B') =>
                  setFormState((prev) => ({ ...prev, modelSize: value }))
                }
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1.7B">Qwen3-TTS 1.7B</SelectItem>
                  <SelectItem value="0.6B">Qwen3-TTS 0.6B</SelectItem>
                </SelectContent>
              </Select>
            </div>

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
                    <div className="text-sm font-medium">Generating audio...</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {statusMessage || 'Creating a new version'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  The regenerated clip will appear as a new generation.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Instructions</Label>
            <Textarea
              value={formState.instruct}
              onChange={(e) => setFormState((prev) => ({ ...prev, instruct: e.target.value }))}
              disabled={isSubmitting}
              className="min-h-20"
              placeholder="Optional delivery instructions"
            />
          </div>
        </div>

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
      </DialogContent>
    </Dialog>
  );
}
