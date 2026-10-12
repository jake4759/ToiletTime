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

export interface NewRestroom {
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

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}
