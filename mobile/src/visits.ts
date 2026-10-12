import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';
import { distanceMeters } from './geo';
import type { Here, Place, Restroom } from './types';

/** How close a restroom has to be for the app to tell the server you're near it. */
const NEARBY_M = 300;
/** At most one visit update per minute. */
const PING_EVERY_MS = 60_000;

const toHere = (p: Location.LocationObject): Here => ({
  lat: p.coords.latitude,
  lng: p.coords.longitude,
  accuracy: p.coords.accuracy ?? 50,
});

/** Where you are right now, to send with a review (null without location permission). */
export async function currentHere(): Promise<Here | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const recent = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 });
    if (recent) return toHere(recent);
    return toHere(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  } catch {
    return null;
  }
}

/** Restrooms (by id) and map places (by OpenStreetMap id) you were near recently. */
export interface RecentVisits {
  restroomIds: Set<string>;
  osmIds: Set<string>;
}

const NO_VISITS: RecentVisits = { restroomIds: new Set(), osmIds: new Set() };

/**
 * While the app is open and you're signed in, lets the server know which restrooms you're near,
 * so you can rate them any time in the next 24 hours. Returns the ones you can still rate.
 */
export function useVisitPings(
  signedIn: boolean,
  fix: Here | null,
  restrooms: Restroom[],
  places: Place[],
): RecentVisits {
  const last = useRef<{ at: number; key: string } | null>(null);
  const [recent, setRecent] = useState<RecentVisits>(NO_VISITS);

  const refresh = useCallback(() => {
    api.recentVisits().then(
      (r) => setRecent({ restroomIds: new Set(r.restroomIds), osmIds: new Set(r.osmIds) }),
      () => {},
    );
  }, []);

  useEffect(() => {
    if (signedIn) refresh();
    else last.current = null;
  }, [signedIn, refresh]);

  useEffect(() => {
    if (!signedIn || !fix) return;
    const from = { latitude: fix.lat, longitude: fix.lng };
    const near = (lat: number, lng: number) => distanceMeters(from, { latitude: lat, longitude: lng }) <= NEARBY_M;
    const restroomIds = restrooms.filter((r) => near(r.lat, r.lng)).map((r) => r.id);
    const nearbyPlaces = places
      .filter((p) => near(p.lat, p.lng))
      .slice(0, 100)
      .map((p) => ({ osmId: p.osmId, lat: p.lat, lng: p.lng }));
    if (!restroomIds.length && !nearbyPlaces.length) return;

    const key = [...restroomIds, ...nearbyPlaces.map((p) => p.osmId)].sort().join(',');
    const now = Date.now();
    // Send when something new is nearby, or refresh the same ones once a minute at most.
    const since = last.current ? now - last.current.at : Infinity;
    if (since < 10_000 || (last.current?.key === key && since < PING_EVERY_MS)) return;
    last.current = { at: now, key };
    api
      .visits(fix, restroomIds.slice(0, 50), nearbyPlaces)
      .then((r) => r.recorded > 0 && refresh())
      .catch(() => {});
  }, [signedIn, fix, restrooms, places, refresh]);

  return signedIn ? recent : NO_VISITS;
}

/** Whether you can rate something: you're close enough now, or you were near it recently. */
export function canReview(
  target: { lat: number; lng: number; id?: string; osmId?: string | null },
  fix: Here | null,
  radiusM: number,
  recent: RecentVisits,
): boolean {
  if (target.id && recent.restroomIds.has(target.id)) return true;
  if (target.osmId && recent.osmIds.has(target.osmId)) return true;
  if (!fix) return false;
  const slack = Math.min(fix.accuracy, 100);
  return (
    distanceMeters({ latitude: fix.lat, longitude: fix.lng }, { latitude: target.lat, longitude: target.lng }) <=
    radiusM + slack
  );
}
