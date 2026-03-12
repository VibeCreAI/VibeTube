import { create } from 'zustand';
import type { LanguageCode, TranscriptionLanguageCode } from '@/lib/constants/languages';
import type { RecordingPromptMode } from '@/lib/constants/voiceSampleScripts';

// Draft state for the create voice profile form
export interface ProfileFormDraft {
  name: string;
  description: string;
  language: LanguageCode;
  transcriptionLanguage: TranscriptionLanguageCode;
  recordingPromptMode: RecordingPromptMode;
  referenceText: string;
  sampleMode: 'upload' | 'record' | 'system';
  // Note: File objects can't be persisted, so we store metadata
  sampleFileName?: string;
  sampleFileType?: string;
  sampleFileData?: string; // Base64 encoded
}

interface UIStore {
  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  // Modals
  profileDialogOpen: boolean;
  setProfileDialogOpen: (open: boolean) => void;
  editingProfileId: string | null;
  setEditingProfileId: (id: string | null) => void;

  generationDialogOpen: boolean;
  setGenerationDialogOpen: (open: boolean) => void;

  // Selected profile for generation
  selectedProfileId: string | null;
  setSelectedProfileId: (id: string | null) => void;

  // Profile form draft (for persisting create voice modal state)
  profileFormDraft: ProfileFormDraft | null;
  setProfileFormDraft: (draft: ProfileFormDraft | null) => void;

  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;

  // VibeTube shared draft state
  vibetubeBackgroundImageData: string;
  setVibetubeBackgroundImageData: (data: string) => void;
}

const THEME_STORAGE_KEY = 'vibetube-theme';

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return 'dark';
}

function applyTheme(theme: 'light' | 'dark') {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
}

const initialTheme = getInitialTheme();
applyTheme(initialTheme);

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  profileDialogOpen: false,
  setProfileDialogOpen: (open) => set({ profileDialogOpen: open }),
  editingProfileId: null,
  setEditingProfileId: (id) => set({ editingProfileId: id }),

  generationDialogOpen: false,
  setGenerationDialogOpen: (open) => set({ generationDialogOpen: open }),

  selectedProfileId: null,
  setSelectedProfileId: (id) => set({ selectedProfileId: id }),

  profileFormDraft: null,
  setProfileFormDraft: (draft) => set({ profileFormDraft: draft }),

  theme: initialTheme,
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  },

  vibetubeBackgroundImageData: '',
  setVibetubeBackgroundImageData: (data) => set({ vibetubeBackgroundImageData: data }),
}));
