import { Loader2, Mic } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  engineSupportsInstruct,
  getGenerationModelOptions,
  getGenerationModelSelection,
  getLanguageOptionsForEngine,
  getModelSelectionFromName,
} from '@/lib/constants/tts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useGenerationForm } from '@/lib/hooks/useGenerationForm';
import { useProfile } from '@/lib/hooks/useProfiles';
import { useUIStore } from '@/stores/uiStore';
import type { LanguageCode } from '@/lib/constants/languages';

export function GenerationForm() {
  const selectedProfileId = useUIStore((state) => state.selectedProfileId);
  const { data: selectedProfile } = useProfile(selectedProfileId || '');

  const { form, handleSubmit, isPending, statusMessage } = useGenerationForm();
  const selectedLanguage = form.watch('language');
  const selectedModel = getGenerationModelSelection(selectedLanguage, {
    engine: form.watch('engine'),
    modelSize: form.watch('modelSize'),
  });
  const languageOptions = getLanguageOptionsForEngine(selectedModel.engine);
  const supportsInstruct = engineSupportsInstruct(selectedModel.engine);
  const modelOptions = getGenerationModelOptions(selectedLanguage);

  useEffect(() => {
    if (!selectedProfile?.language) {
      return;
    }
    const nextLanguage = selectedProfile.language as LanguageCode;
    const nextModel = getGenerationModelSelection(nextLanguage, {
      engine: selectedModel.engine,
      modelSize: selectedModel.modelSize,
    });
    form.setValue('language', nextLanguage, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue('engine', nextModel.engine, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue('modelSize', nextModel.modelSize, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [form, selectedModel.engine, selectedModel.modelSize, selectedProfile?.id, selectedProfile?.language]);

  async function onSubmit(data: Parameters<typeof handleSubmit>[0]) {
    await handleSubmit(data, selectedProfileId);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate Speech</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <FormLabel>Voice Profile</FormLabel>
              {selectedProfile ? (
                <div className="mt-2 p-3 border rounded-md bg-muted/50 flex items-center gap-2">
                  <Mic className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{selectedProfile.name}</span>
                  <span className="text-sm text-muted-foreground">{selectedProfile.language}</span>
                </div>
              ) : (
                <div className="mt-2 p-3 border border-dashed rounded-md text-sm text-muted-foreground">
                  Click on a profile card above to select a voice profile
                </div>
              )}
            </div>

            <FormField
              control={form.control}
              name="text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Text to Speak</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter the text you want to generate..."
                      className="min-h-[150px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>Max 5000 characters</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {supportsInstruct && (
              <FormField
                control={form.control}
                name="instruct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Delivery Instructions (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="e.g. Speak slowly with emphasis, Warm and friendly tone, Professional and authoritative..."
                        className="min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Natural language instructions to control speech delivery (tone, emotion,
                      pace). Max 500 characters
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid gap-4 md:grid-cols-3">

              <FormField
                control={form.control}
                name="language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Language</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {languageOptions.map((lang) => (
                          <SelectItem key={lang.value} value={lang.value}>
                            {lang.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="engine"
                render={() => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <Select
                      value={selectedModel.modelName}
                      onValueChange={(value) => {
                        const nextModel = getModelSelectionFromName(value);
                        form.setValue('engine', nextModel.engine, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                        form.setValue('modelSize', nextModel.modelSize, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {modelOptions.map((option) => (
                          <SelectItem key={option.modelName} value={option.modelName}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Only models that support the selected language are shown.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="seed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Seed (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Random"
                        {...field}
                        onChange={(e) =>
                          field.onChange(e.target.value ? parseInt(e.target.value, 10) : undefined)
                        }
                      />
                    </FormControl>
                    <FormDescription>For reproducible results</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isPending || !selectedProfileId}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {statusMessage || 'Generating...'}
                </>
              ) : (
                'Generate Speech'
              )}
            </Button>
            {isPending && statusMessage && (
              <div className="text-sm text-muted-foreground">{statusMessage}</div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
