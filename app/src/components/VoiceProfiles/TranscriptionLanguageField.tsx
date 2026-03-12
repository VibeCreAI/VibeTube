import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  type TranscriptionLanguageCode,
} from '@/lib/constants/languages';

interface TranscriptionLanguageFieldProps {
  value: TranscriptionLanguageCode;
  onChange: (value: TranscriptionLanguageCode) => void;
  disabled?: boolean;
}

export function TranscriptionLanguageField({
  value,
  onChange,
  disabled = false,
}: TranscriptionLanguageFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="transcription-language">Transcription Language</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as TranscriptionLanguageCode)}
        disabled={disabled}
      >
        <SelectTrigger id="transcription-language">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TRANSCRIPTION_LANGUAGE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Only affects transcription. Profile language stays separate.
      </p>
    </div>
  );
}
