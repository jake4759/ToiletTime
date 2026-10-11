# ToiletTime

Find and rate restrooms at stores, restaurants, cafés and other businesses around the world.

## Features

- **World map.** Every restroom appears as a pin colored by its average rating.
- **Add a restroom.** Search for a business by name to fill in its address and location automatically, or click the map to place it manually.
- **Detailed ratings.** Reviews score overall experience, cleanliness, supplies and privacy, with an optional written review.
- **Search and filter.** Filter by name, city, country or place type, and sort by rating, review count or date added.
- **Amenities.** Each listing notes whether it is free to use, wheelchair accessible and has a baby changing station.
- Light and dark themes, and a responsive layout for phones.

## Getting started

Requires Node.js 18 or later. There are no dependencies to install.

```bash
npm start   # http://localhost:3000
npm test
```

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DB_FILE` | `data/db.json` | Where ratings are stored. Created on first write, starting from `data/seed.json`. |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/bathrooms?q=&type=&sort=` | List restrooms with average ratings |
| `POST` | `/api/bathrooms` | Add a restroom (`name`, `lat`, `lng`, optional `review`) |
| `GET` | `/api/bathrooms/:id` | Restroom details and all reviews |
| `POST` | `/api/bathrooms/:id/reviews` | Add a review (`overall`, `cleanliness`, `supplies`, `privacy` from 1 to 5, optional `author` and `comment`) |

## Third-party services

Map tiles are provided by [CARTO](https://carto.com/attributions) using [OpenStreetMap](https://www.openstreetmap.org/copyright) data. Place search uses the OpenStreetMap [Nominatim](https://nominatim.org/) service, which is subject to its usage policy; high-traffic deployments should use a self-hosted or commercial geocoder. Leaflet is bundled under `public/vendor/leaflet` (BSD-2-Clause).
