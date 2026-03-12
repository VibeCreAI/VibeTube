import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit, Mic, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { ProfileForm } from '@/components/VoiceProfiles/ProfileForm';
import { apiClient } from '@/lib/api/client';
import type { VibeTubeAvatarPackResponse, VoiceProfileResponse } from '@/lib/api/types';
import { BOTTOM_SAFE_AREA_PADDING } from '@/lib/constants/ui';
import { useHistory } from '@/lib/hooks/useHistory';
import { useDeleteProfile, useProfileSamples, useProfiles } from '@/lib/hooks/useProfiles';
import { cn } from '@/lib/utils/cn';
import { usePlayerStore } from '@/stores/playerStore';
import { useServerStore } from '@/stores/serverStore';
import { useUIStore } from '@/stores/uiStore';

export function VoicesTab() {
  const { data: profiles, isLoading } = useProfiles();
  const { data: historyData } = useHistory({ limit: 1000 });
  const queryClient = useQueryClient();
  const setDialogOpen = useUIStore((state) => state.setProfileDialogOpen);
  const setEditingProfileId = useUIStore((state) => state.setEditingProfileId);
  const setSelectedProfileId = useUIStore((state) => state.setSelectedProfileId);
  const selectedProfileId = useUIStore((state) => state.selectedProfileId);
  const deleteProfile = useDeleteProfile();
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioUrl = usePlayerStore((state) => state.audioUrl);
  const isPlayerVisible = !!audioUrl;
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const { toast } = useToast();

  // Get generation counts per profile
  const generationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (historyData?.items) {
      historyData.items.forEach((item) => {
        counts[item.profile_id] = (counts[item.profile_id] || 0) + 1;
      });
    }
    return counts;
  }, [historyData]);

  // Get channel assignments for each profile
  const { data: channelAssignments } = useQuery({
    queryKey: ['profile-channels'],
    queryFn: async () => {
      if (!profiles) return {};
      const assignments: Record<string, string[]> = {};
      for (const profile of profiles) {
        try {
          const result = await apiClient.getProfileChannels(profile.id);
          assignments[profile.id] = result.channel_ids;
        } catch {
          assignments[profile.id] = [];
        }
      }
      return assignments;
    },
    enabled: !!profiles,
  });

  // Get all channels
  const { data: channels } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiClient.listChannels(),
  });

  const { data: avatarPacks } = useQuery({
    queryKey: ['vibetube-avatar-packs', profiles?.map((profile) => profile.id).join(',')],
    queryFn: async () => {
      if (!profiles?.length) {
        return {} as Record<string, VibeTubeAvatarPackResponse | null>;
      }
      const entries = await Promise.all(
        profiles.map(async (profile) => {
          try {
            const pack = await apiClient.getVibeTubeAvatarPack(profile.id);
            return [profile.id, pack] as const;
          } catch {
            return [profile.id, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, VibeTubeAvatarPackResponse | null>;
    },
    enabled: !!profiles?.length,
  });

  useEffect(() => {
    if (!profiles) return;
    const validProfileIds = new Set(profiles.map((profile) => profile.id));
    setSelectedProfileIds((prev) => prev.filter((id) => validProfileIds.has(id)));
  }, [profiles]);

  const handleEdit = (profileId: string) => {
    setEditingProfileId(profileId);
    setDialogOpen(true);
  };

  const handleProfileDelete = async (profileId: string) => {
    if (await confirm('Are you sure you want to delete this profile?')) {
      deleteProfile.mutate(profileId);
    }
  };

  const handleChannelChange = async (profileId: string, channelIds: string[]) => {
    try {
      await apiClient.setProfileChannels(profileId, channelIds);
      queryClient.invalidateQueries({ queryKey: ['profile-channels'] });
    } catch (error) {
      console.error('Failed to update channels:', error);
    }
  };

  const allVisibleProfileIds = profiles?.map((profile) => profile.id) || [];
  const allSelected =
    allVisibleProfileIds.length > 0 && selectedProfileIds.length === allVisibleProfileIds.length;

  const handleToggleAllProfiles = (checked: boolean) => {
    setSelectedProfileIds(checked ? allVisibleProfileIds : []);
  };

  const handleToggleProfileSelection = (profileId: string, checked: boolean) => {
    setSelectedProfileIds((prev) =>
      checked ? [...new Set([...prev, profileId])] : prev.filter((id) => id !== profileId),
    );
  };

  const handleBulkDelete = async () => {
    if (selectedProfileIds.length === 0) return;
    const confirmed = await confirm(
      `Delete ${selectedProfileIds.length} selected character${selectedProfileIds.length === 1 ? '' : 's'}? This action cannot be undone.`,
    );
    if (!confirmed) return;

    setIsBulkDeleting(true);
    try {
      const results = await Promise.allSettled(
        selectedProfileIds.map((profileId) => deleteProfile.mutateAsync(profileId)),
      );
      const deletedCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - deletedCount;

      if (selectedProfileId && selectedProfileIds.includes(selectedProfileId)) {
        setSelectedProfileId(null);
      }

      setSelectedProfileIds([]);

      if (failedCount > 0) {
        console.error('Some profile deletions failed', results);
      }

      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      await queryClient.invalidateQueries({ queryKey: ['profile-channels'] });

      if (deletedCount > 0) {
        toast({
          title: 'Profiles deleted',
          description: `Deleted ${deletedCount} profile${deletedCount === 1 ? '' : 's'}.`,
        });
      }

      if (failedCount > 0) {
        toast({
          title: 'Some deletions failed',
          description: `${failedCount} profile${failedCount === 1 ? '' : 's'} could not be deleted.`,
          variant: 'destructive',
        });
      }
    } finally {
      setIsBulkDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading profiles...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Scroll Mask - Always visible, behind content */}
      <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />

      {/* Fixed Header */}
      <div className="absolute top-0 left-0 right-0 z-20">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Profiles</h1>
            {selectedProfileIds.length > 0 && (
              <div className="text-sm text-muted-foreground">
                {selectedProfileIds.length} selected
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedProfileIds.length > 0 && (
              <Button variant="destructive" onClick={handleBulkDelete} disabled={isBulkDeleting}>
                <Trash2 className="h-4 w-4 mr-2" />
                {isBulkDeleting ? 'Deleting...' : `Delete Selected (${selectedProfileIds.length})`}
              </Button>
            )}
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Profile
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div
        ref={scrollRef}
        className={cn(
          'flex-1 overflow-y-auto pt-16 relative z-0',
          isPlayerVisible && BOTTOM_SAFE_AREA_PADDING,
        )}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[52px]">
                <Checkbox checked={allSelected} onCheckedChange={handleToggleAllProfiles} />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Avatar States</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Generations</TableHead>
              <TableHead>Samples</TableHead>
              <TableHead>Channels</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles?.map((profile) => (
              <VoiceRow
                key={profile.id}
                profile={profile}
                selected={selectedProfileIds.includes(profile.id)}
                avatarPack={avatarPacks?.[profile.id] ?? null}
                generationCount={generationCounts[profile.id] || 0}
                channelIds={channelAssignments?.[profile.id] || []}
                channels={channels || []}
                onSelect={(checked) => handleToggleProfileSelection(profile.id, checked)}
                onChannelChange={(channelIds) => handleChannelChange(profile.id, channelIds)}
                onEdit={() => handleEdit(profile.id)}
                onDelete={() => handleProfileDelete(profile.id)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <ProfileForm />
    </div>
  );
}

interface VoiceRowProps {
  profile: VoiceProfileResponse;
  selected: boolean;
  avatarPack: VibeTubeAvatarPackResponse | null;
  generationCount: number;
  channelIds: string[];
  channels: Array<{ id: string; name: string; is_default: boolean }>;
  onSelect: (checked: boolean) => void;
  onChannelChange: (channelIds: string[]) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function VoiceRow({
  profile,
  selected,
  avatarPack,
  generationCount,
  channelIds,
  channels,
  onSelect,
  onChannelChange,
  onEdit,
  onDelete,
}: VoiceRowProps) {
  const { data: samples } = useProfileSamples(profile.id);
  const serverUrl = useServerStore((state) => state.serverUrl);
  const avatarUrl = profile.avatar_path ? `${serverUrl}/profiles/${profile.id}/avatar` : null;
  const stateThumbs = [
    {
      key: 'idle',
      label: 'Idle',
      url: avatarPack?.idle_url ? apiClient.getVibeTubeAvatarStateUrl(profile.id, 'idle') : null,
    },
    {
      key: 'talk',
      label: 'Talk',
      url: avatarPack?.talk_url ? apiClient.getVibeTubeAvatarStateUrl(profile.id, 'talk') : null,
    },
    {
      key: 'idle_blink',
      label: 'Idle Blink',
      url: avatarPack?.idle_blink_url
        ? apiClient.getVibeTubeAvatarStateUrl(profile.id, 'idle_blink')
        : null,
    },
    {
      key: 'talk_blink',
      label: 'Talk Blink',
      url: avatarPack?.talk_blink_url
        ? apiClient.getVibeTubeAvatarStateUrl(profile.id, 'talk_blink')
        : null,
    },
  ].filter((item) => item.url);
  const versionTag = encodeURIComponent(profile.updated_at);

  return (
    <TableRow className="cursor-pointer" onClick={onEdit}>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onSelect} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden border">
            {avatarUrl ? (
              <img
                src={`${avatarUrl}?t=${versionTag}`}
                alt={`${profile.name} avatar`}
                className="h-full w-full object-cover"
              />
            ) : (
              <Mic className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div>
            <div className="font-medium">{profile.name}</div>
            {profile.description && (
              <div className="text-sm text-muted-foreground">{profile.description}</div>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        {stateThumbs.length > 0 ? (
          <div className="flex items-center gap-1.5">
            {stateThumbs.map((state) => (
              <div
                key={state.key}
                className="h-8 w-8 rounded border bg-muted/30 overflow-hidden"
                title={state.label}
              >
                <img
                  src={`${state.url}?t=${versionTag}`}
                  alt={`${profile.name} ${state.label}`}
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No VibeTube pack</span>
        )}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>{profile.language}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>{generationCount}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>{samples?.length || 0}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <MultiSelect
          options={channels.map((ch) => ({
            value: ch.id,
            label: `${ch.name}${ch.is_default ? ' (Default)' : ''}`,
          }))}
          value={channelIds}
          onChange={onChannelChange}
          placeholder="Select channels..."
          className="min-w-[200px]"
        />
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={onEdit}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
