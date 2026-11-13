// Profile + app-level settings, persisted in IndexedDB and mirrored into a
// zustand store so React components can read them synchronously.
import { create } from 'zustand';
import { DEFAULT_PROFILE, type LocalProfile } from '../chess/types';
import { getSetting, setSetting } from './db';

const PROFILE_KEY = 'profile';

interface ProfileState {
  profile: LocalProfile;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<LocalProfile>) => Promise<void>;
}

export const useProfile = create<ProfileState>((set, get) => ({
  profile: DEFAULT_PROFILE,
  loaded: false,
  load: async () => {
    const stored = await getSetting<Partial<LocalProfile>>(PROFILE_KEY, {});
    set({ profile: { ...DEFAULT_PROFILE, ...stored }, loaded: true });
  },
  update: async (patch) => {
    const next = { ...get().profile, ...patch };
    set({ profile: next });
    await setSetting(PROFILE_KEY, next);
  },
}));

export function profile(): LocalProfile {
  return useProfile.getState().profile;
}
