export type AvatarPresetStateKey = 'idle' | 'talk' | 'idle_blink' | 'talk_blink';

export interface AvatarPresetOption {
  id: string;
  name: string;
  avatarUrl: string;
  states: Record<AvatarPresetStateKey, string>;
}

function assetUrl(path: string): string {
  return new URL(`../../assets/avatar-presets/${path}`, import.meta.url).href;
}

export const AVATAR_PRESET_OPTIONS: AvatarPresetOption[] = [
  {
    id: 'erin',
    name: 'Erin',
    avatarUrl: assetUrl('erin/idle.png'),
    states: {
      idle: assetUrl('erin/idle.png'),
      talk: assetUrl('erin/talk.png'),
      idle_blink: assetUrl('erin/idle_blink.png'),
      talk_blink: assetUrl('erin/talk_blink.png'),
    },
  },
  {
    id: 'haylin',
    name: 'Haylin',
    avatarUrl: assetUrl('haylin/idle.png'),
    states: {
      idle: assetUrl('haylin/idle.png'),
      talk: assetUrl('haylin/talk.png'),
      idle_blink: assetUrl('haylin/idle_blink.png'),
      talk_blink: assetUrl('haylin/talk_blink.png'),
    },
  },
  {
    id: 'jessa',
    name: 'Jessa',
    avatarUrl: assetUrl('jessa/idle.png'),
    states: {
      idle: assetUrl('jessa/idle.png'),
      talk: assetUrl('jessa/talk.png'),
      idle_blink: assetUrl('jessa/idle_blink.png'),
      talk_blink: assetUrl('jessa/talk_blink.png'),
    },
  },
  {
    id: 'samson',
    name: 'Samson',
    avatarUrl: assetUrl('samson/idle.png'),
    states: {
      idle: assetUrl('samson/idle.png'),
      talk: assetUrl('samson/talk.png'),
      idle_blink: assetUrl('samson/idle_blink.png'),
      talk_blink: assetUrl('samson/talk_blink.png'),
    },
  },
  {
    id: 'serine',
    name: 'Serine',
    avatarUrl: assetUrl('serine/idle.png'),
    states: {
      idle: assetUrl('serine/idle.png'),
      talk: assetUrl('serine/talk.png'),
      idle_blink: assetUrl('serine/idle_blink.png'),
      talk_blink: assetUrl('serine/talk_blink.png'),
    },
  },
  {
    id: 'tracy',
    name: 'Tracy',
    avatarUrl: assetUrl('tracy/idle.png'),
    states: {
      idle: assetUrl('tracy/idle.png'),
      talk: assetUrl('tracy/talk.png'),
      idle_blink: assetUrl('tracy/idle_blink.png'),
      talk_blink: assetUrl('tracy/talk_blink.png'),
    },
  },
];

async function assetUrlToFile(url: string, fileName: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load preset asset "${fileName}".`);
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'image/png' });
}

export async function loadAvatarPresetFiles(
  preset: AvatarPresetOption,
): Promise<Record<AvatarPresetStateKey, File>> {
  const entries = await Promise.all(
    (Object.entries(preset.states) as Array<[AvatarPresetStateKey, string]>).map(
      async ([state, url]) =>
        [
          state,
          await assetUrlToFile(url, `${preset.id}-${state}.png`),
        ] as const,
    ),
  );

  return Object.fromEntries(entries) as Record<AvatarPresetStateKey, File>;
}
