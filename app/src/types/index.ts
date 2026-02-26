// Shared TypeScript types for the VibeTube application

export interface VoiceProfile {
  id: string;
  name: string;
  description?: string;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export interface Generation {
  id: string;
  profileId: string;
  text: string;
  language: string;
  audioPath: string;
  duration: number;
  seed?: number;
  createdAt: string;
}

export interface ServerConfig {
  url: string;
  isRemote: boolean;
  isRunning: boolean;
}

