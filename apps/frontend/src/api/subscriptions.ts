import { api } from './client';

export type SubscriptionStatus = 'ACTIVE' | 'GRACE' | 'SUSPENDED' | 'CANCELLED';

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  routerId: string;
  hotspotUsername: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  graceEndsAt: string;
  suspendedAt: string | null;
}

export interface SubscriptionRecommendation {
  subscription: Subscription;
  daysRemaining: number;
  reason: 'EXPIRING_SOON' | 'IN_GRACE' | 'GRACE_ENDED';
  recommendedAction: 'WARN_CUSTOMER' | 'SUSPEND';
}

export interface CreateSubscriptionInput {
  customerId: string;
  planId: string;
  hotspotUsername: string;
  password: string;
  routerId?: string;
}

export const subscriptionsApi = {
  list: (status?: SubscriptionStatus) =>
    api.get<Subscription[]>(`/subscriptions${status ? `?status=${status}` : ''}`),
  recommendations: () => api.get<SubscriptionRecommendation[]>('/subscriptions/recommendations'),
  create: (input: CreateSubscriptionInput) => api.post<Subscription>('/subscriptions', input),
  suspend: (id: string) => api.post<Subscription>(`/subscriptions/${id}/suspend`),
  resume: (id: string) => api.post<Subscription>(`/subscriptions/${id}/resume`),
  renew: (id: string) => api.post<Subscription>(`/subscriptions/${id}/renew`),
};
