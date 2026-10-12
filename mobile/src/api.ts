import Constants from 'expo-constants';

import type { NewRestroom, Place, PlaceType, Restroom, RestroomDetail, Review, ReviewDraft, User } from './types';

/**
 * Where the ToiletTime server lives. Set EXPO_PUBLIC_API_URL for a deployed server;
 * otherwise assume it runs on port 3000 of the computer serving the Expo bundle.
 */
function resolveApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${devHost ?? 'localhost'}:3000`;
}

export const API_URL = resolveApiUrl();
export const IS_HOSTED_API = !!process.env.EXPO_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let authToken: string | null = null;

/** Token sent with every request once the user is signed in (managed by AuthProvider). */
export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const { body, method = body === undefined ? 'GET' : 'POST' } = options;
  const token = options.token ?? authToken;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the ToiletTime server. Check your internet connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

interface Session {
  token: string;
  user: User;
}

export const api = {
  list: () => request<{ bathrooms: Restroom[] }>('/api/bathrooms').then((d) => d.bathrooms),
  get: (id: string) => request<RestroomDetail>(`/api/bathrooms/${encodeURIComponent(id)}`),
  create: (restroom: NewRestroom) => request<RestroomDetail>('/api/bathrooms', { body: restroom }),
  review: (id: string, review: ReviewDraft) =>
    request<Review>(`/api/bathrooms/${encodeURIComponent(id)}/reviews`, { body: review }),

  places: (b: { south: number; west: number; north: number; east: number }) =>
    request<{ places: Place[]; zoomIn: boolean }>(
      `/api/places?south=${b.south}&west=${b.west}&north=${b.north}&east=${b.east}`,
    ),

  signUp: (name: string, email: string, password: string) =>
    request<Session>('/api/auth/signup', { body: { name, email, password } }),
  signIn: (email: string, password: string) => request<Session>('/api/auth/login', { body: { email, password } }),
  me: (token: string) => request<{ user: User }>('/api/auth/me', { token }).then((d) => d.user),
  signOut: () => request<{ ok: true }>('/api/auth/logout', { body: {} }),
  deleteAccount: () => request<{ ok: true }>('/api/auth/me', { method: 'DELETE' }),
};

// ---------- place search (OpenStreetMap Nominatim) ----------

export interface PlaceResult {
  id: string;
  name: string;
  subtitle: string;
  type: PlaceType;
  address: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
}

interface NominatimHit {
  place_id: number;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}

function guessType(hit: NominatimHit): PlaceType {
  const t = `${hit.category}:${hit.type}`;
  if (/fast_food|restaurant|food_court/.test(t)) return 'restaurant';
  if (/cafe/.test(t)) return 'cafe';
  if (/mall/.test(t)) return 'mall';
  if (/fuel/.test(t)) return 'gas_station';
  if (/hotel|hostel|motel/.test(t)) return 'hotel';
  if (/bar|pub/.test(t)) return 'bar';
  if (/^shop:/.test(t)) return 'store';
  if (/toilets/.test(t)) return 'public';
  return 'other';
}

export async function searchPlaces(
  query: string,
  near?: { latitude: number; longitude: number },
): Promise<PlaceResult[]> {
  const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '8', q: query });
  if (near) {
    const d = 0.5;
    params.set('viewbox', [near.longitude - d, near.latitude + d, near.longitude + d, near.latitude - d].join(','));
  }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'ToiletTime/1.0 (iOS)' },
  });
  if (!res.ok) throw new Error('Place search is unavailable right now.');
  const hits: NominatimHit[] = await res.json();
  return hits.map((h) => {
    const a = h.address ?? {};
    const [first, ...rest] = h.display_name.split(', ');
    return {
      id: String(h.place_id),
      name: h.name || first,
      subtitle: rest.join(', '),
      type: guessType(h),
      address: [a.house_number, a.road].filter(Boolean).join(' '),
      city: a.city || a.town || a.village || a.suburb || '',
      country: a.country || '',
      lat: Number(h.lat),
      lng: Number(h.lon),
    };
  });
}
