import Constants from 'expo-constants';

import type { NewRestroom, PlaceType, Restroom, RestroomDetail, Review, ReviewDraft } from './types';

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

async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Can't reach the ToiletTime server at ${API_URL}.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  list: () => request<{ bathrooms: Restroom[] }>('/api/bathrooms').then((d) => d.bathrooms),
  get: (id: string) => request<RestroomDetail>(`/api/bathrooms/${encodeURIComponent(id)}`),
  create: (restroom: NewRestroom) => request<RestroomDetail>('/api/bathrooms', restroom),
  review: (id: string, review: ReviewDraft) =>
    request<Review>(`/api/bathrooms/${encodeURIComponent(id)}/reviews`, review),
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
