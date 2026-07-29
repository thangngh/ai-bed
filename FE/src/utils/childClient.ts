import { apiClient } from './api';
import { ChildProfile } from '../types';

interface ChildApiResponse {
  child_id: string;
  child_name: string;
  age: number;
}

export const childClient = {
  list: async (): Promise<ChildProfile[]> => {
    const data = await apiClient<any>('/child-profile');
    const children = data.children || [];
    return children.map((c: ChildApiResponse) => ({
      childId: c.child_id,
      childName: c.child_name,
      age: c.age as any,
    }));
  },

  getByName: async (name: string): Promise<ChildProfile | null> => {
    const data = await apiClient<any>(`/child-profile?child_name=${encodeURIComponent(name)}`);
    if (!data.child_id) return null;
    return { childId: data.child_id, childName: data.child_name, age: data.age };
  },

  create: async (input: { child_name: string; age: number; gender?: string; preferred_characters?: string; bedtime_goal?: string }): Promise<ChildProfile> => {
    const data = await apiClient<any>('/child-profile', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { childId: data.child_id, childName: data.child_name, age: data.age };
  },

  update: async (childId: string, input: { age?: number; gender?: string; interests?: string; preferred_characters?: string; bedtime_goal?: string }): Promise<ChildProfile> => {
    const data = await apiClient<any>(`/child-profile/${childId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return { childId: data.child_id, childName: data.child_name, age: data.age };
  },

  delete: async (childId: string): Promise<void> => {
    await apiClient(`/child-profile/${childId}`, { method: 'DELETE' });
  },
};