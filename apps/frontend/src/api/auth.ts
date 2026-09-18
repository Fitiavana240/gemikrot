import { api } from './client';
import type { AuthUser } from './types';

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/login', { email, password });
}
