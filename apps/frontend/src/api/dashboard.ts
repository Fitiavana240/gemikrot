import { api } from './client';
import type { DashboardSummary } from './types';

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary'),
};
