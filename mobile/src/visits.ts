import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';

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

/**
 * While the app is open and you're signed in, lets the server know which restrooms you're near,
 * so you can rate them any time in the next 24 hours.
 */
export function useVisitPings(
  signedIn: boolean,
  fix: Here | null,
  restrooms: Restroom[],
  places: Place[],
) {
  const last = useRef<{ at: number; key: string } | null>(null);

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
    api.visits(fix, restroomIds.slice(0, 50), nearbyPlaces).catch(() => {});
  }, [signedIn, fix, restrooms, places]);
}
