import type { CharacterConfig } from './character/draw';

export const PLACE_TYPES = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  store: 'Store',
  mall: 'Shopping center',
  gas_station: 'Gas station',
  hotel: 'Hotel',
  bar: 'Bar',
  public: 'Public restroom',
  other: 'Other',
} as const;

export type PlaceType = keyof typeof PLACE_TYPES;

export interface Restroom {
  id: string;
  name: string;
  type: PlaceType;
  address: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  accessible: boolean;
  free: boolean;
  babyChanging: boolean;
  osmId?: string | null;
  createdAt: string;
  reviewCount: number;
  rating: number | null;
  cleanliness: number | null;
  supplies: number | null;
  privacy: number | null;
}

export interface Review {
  id: string;
  userId: string | null;
  author: string;
  authorAvatarUrl?: string | null;
  /** The author's character, when they show it on reviews instead of their picture. */
  authorCharacter?: Partial<CharacterConfig> | null;
  /** When the author last changed the review, if they did. */
  editedAt?: string | null;
  /** Hidden after several people reported it (only shown to its author). */
  hidden?: boolean;
  overall: number;
  cleanliness: number;
  supplies: number;
  privacy: number;
  comment: string;
  createdAt: string;
}

export interface RestroomDetail extends Restroom {
  reviews: Review[];
}

export interface ReviewDraft {
  overall: number;
  cleanliness: number;
  supplies: number;
  privacy: number;
  comment: string;
}

/** A business or mapped restroom from OpenStreetMap that may not be rated yet. */
export interface Place {
  osmId: string;
  name: string;
  type: PlaceType;
  isRestroom: boolean;
  address: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  free: boolean;
  accessible: boolean;
  babyChanging: boolean;
}

export interface NewRestroom {
  osmId?: string;
  name: string;
  type: PlaceType;
  address: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  accessible: boolean;
  free: boolean;
  babyChanging: boolean;
  review: ReviewDraft;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export const RATING_CATEGORIES = [
  ['overall', 'Overall'],
  ['cleanliness', 'Cleanliness'],
  ['supplies', 'Supplies'],
  ['privacy', 'Privacy'],
] as const;

export const emptyReview = (): ReviewDraft => ({
  overall: 0,
  cleanliness: 0,
  supplies: 0,
  privacy: 0,
  comment: '',
});

/** The signed-in person: their Supabase account plus their ToiletTime profile. */
export interface User {
  id: string;
  username: string | null;
  avatarUrl: string | null;
  markerColor: string | null;
  email: string;
  emailVerified: boolean;
  provider: string;
  createdAt: string;
  character: CharacterConfig;
  /** What shows next to your reviews (null: your character unless you have a picture). */
  reviewIcon: 'character' | 'photo' | null;
  reviewCount: number;
  /** Restrooms you were the first to review (for Trailblazer items). */
  firstCount: number;
  level: Level;
  nextUnlock: NextUnlock | null;
}

export interface Level {
  name: string;
  next: { name: string; at: number } | null;
}

export interface UnlockedItem {
  slot: string;
  id: string;
  name: string;
}

export interface NextUnlock {
  at: number;
  items: UnlockedItem[];
}

/** What a new review earned: your progress and any closet items it unlocked. */
export interface Rewards {
  reviewCount: number;
  level: Level;
  nextUnlock: NextUnlock | null;
  levelUp: boolean;
  /** You were the first person to review this restroom. */
  firstReview: boolean;
  firstCount: number;
  newItems: UnlockedItem[];
}

/** Where you are, sent with a review so the server can check you've been to the restroom. */
export interface Here {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface ClosetItem {
  id: string;
  name: string;
  unlock: number;
  /** Trailblazer items: how many restrooms you must be the first to review. */
  firsts?: number;
}

export interface ClosetSlot {
  label: string;
  color?: 'hair' | 'clothes';
  items: ClosetItem[];
}

export interface CharacterCatalog {
  slots: Record<string, ClosetSlot>;
  colors: { hair: string[]; clothes: string[]; background?: string[] };
  levels: { min: number; name: string }[];
  defaults: CharacterConfig;
}

export interface MyReview extends Review {
  restroomId: string;
  restroomName: string;
}
