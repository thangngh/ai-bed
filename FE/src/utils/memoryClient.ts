import { apiClient } from './api';
import { MemoryContext } from '../types';

export const memoryClient = {
  async getContext(childId: string): Promise<MemoryContext> {
    return apiClient<MemoryContext>(`/memory/context/${childId}`);
  },
};