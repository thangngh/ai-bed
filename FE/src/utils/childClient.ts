import { apiClient } from './api';
import { AgeGroup, ChildProfile } from '../types';

interface ChildApiResponse {
  child_id: string;
  child_name: string;
  age: number;
  gender: string | null;
  interests: string | null;
  preferred_characters: string | null;
  bedtime_goal: string | null;
}

export interface ChildProfileInput {
  child_name: string;
  age: number;
  gender?: string;
  interests?: string;
  preferred_characters?: string;
  bedtime_goal?: string;
}

export type ChildProfileUpdateInput = Partial<ChildProfileInput>;

/**
 * The editor prefills from whatever this returns, so a field dropped here is a
 * field the next save writes back empty. Every column the BE sends is mapped.
 */
function toProfile(c: ChildApiResponse): ChildProfile {
  return {
    childId: c.child_id,
    childName: c.child_name,
    age: c.age as AgeGroup,
    gender: c.gender ?? undefined,
    interests: c.interests ?? undefined,
    preferredCharacters: c.preferred_characters ?? undefined,
    bedtimeGoal: c.bedtime_goal ?? undefined,
  };
}

export const childClient = {
  list: async (): Promise<ChildProfile[]> => {
    const data = await apiClient<{ children?: ChildApiResponse[] }>('/child-profile');
    return (data.children || []).map(toProfile);
  },

  getByName: async (name: string): Promise<ChildProfile | null> => {
    const data = await apiClient<any>(`/child-profile?child_name=${encodeURIComponent(name)}`);
    if (!data.child_id) return null;
    return toProfile(data);
  },

  create: async (input: ChildProfileInput): Promise<ChildProfile> => {
    const data = await apiClient<ChildApiResponse>('/child-profile', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return toProfile(data);
  },

  update: async (childId: string, input: ChildProfileUpdateInput): Promise<ChildProfile> => {
    const data = await apiClient<ChildApiResponse>(`/child-profile/${childId}/update`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return toProfile(data);
  },

  delete: async (childId: string): Promise<void> => {
    await apiClient(`/child-profile/${childId}/delete`, { method: 'POST' });
  },
};
