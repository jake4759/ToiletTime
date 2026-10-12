# ToiletTime

Find and rate restrooms at stores, restaurants, cafés and other businesses around the world.

ToiletTime has a native iPhone app (`mobile/`, built with Expo and React Native) and a web app (`public/`). Both talk to the same Node server, so ratings added on a phone show up everywhere.

## Features

- **World map.** Every restroom appears as a pin colored by its average rating.
- **Add a restroom.** Search for a business by name to fill in its address and location automatically, or click the map to place it manually.
- **Detailed ratings.** Reviews score overall experience, cleanliness, supplies and privacy, with an optional written review.
- **Search and filter.** Filter by name, city, country or place type, and sort by rating, review count or date added.
- **Amenities.** Each listing notes whether it is free to use, wheelchair accessible and has a baby changing station.
- Light and dark themes, and a responsive layout for phones.

## Run it on your iPhone

You need a computer (Mac, Windows or Linux) with [Node.js](https://nodejs.org) 18 or later, and an iPhone on the same Wi-Fi network.

1. On your iPhone, install **Expo Go** from the App Store.
2. On your computer, in this folder, run:

   ```bash
   npm run setup   # first time only: installs the app's dependencies
   npm run phone   # starts the ToiletTime server and the app's dev server
   ```

3. Open the iPhone **Camera** app and point it at the QR code shown in the terminal, then tap the banner to open ToiletTime in Expo Go.
4. Allow location access when asked, so the map can show restrooms near you.

Changes to the code reload on the phone automatically while `npm run phone` is running.

**If the app says "Not connected":** the phone can't reach the server on port 3000 of your computer. Check that both devices are on the same Wi-Fi network (not a guest network), and allow Node.js through your computer's firewall. Expo's `--tunnel` mode only tunnels the app itself, not the server, so it won't work unless you deploy the server and set `EXPO_PUBLIC_API_URL` (below).

### In the app

- **Map:** Apple Maps with every restroom pinned and colored by rating. Tap a pin for a preview card, then tap the card for full details.
- **Add a restroom:** tap **Add Restroom** to use your location, or touch and hold anywhere on the map. Search for the business to fill in its details, drag the pin to adjust, then rate it.
- **List:** tap the list button or the search bar to search, filter by place type, and sort by distance, rating, review count or date.
- **Details:** overall and per-category scores, amenities, all reviews, directions in Apple Maps, and a **Review** button to add your own rating.

### Using a hosted server

To use the app away from your home Wi-Fi, deploy the server (for example on Render, Railway or Fly.io) and point the app at it:

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://your-server.example.com npx expo start
```

### Installing it as a standalone app

Expo Go is the quickest way to test. To install ToiletTime with its own icon on your Home Screen, or to share it through TestFlight, you need an [Apple Developer Program](https://developer.apple.com/programs/) membership and an [Expo](https://expo.dev) account. Then run `npx eas-cli@latest build --platform ios` from `mobile/`. The app also needs a hosted server for this, since it won't be running next to your computer.

## Web app and server

The server and web app need Node.js 18 or later and have no dependencies to install.

```bash
npm start   # server + web app at http://localhost:3000
npm test    # API tests
```

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DB_FILE` | `data/db.json` | Where ratings are stored. Created on first write, starting from `data/seed.json`. |

For the mobile app, run `npm run lint` and `npm run typecheck` in `mobile/`.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/bathrooms?q=&type=&sort=` | List restrooms with average ratings |
| `POST` | `/api/bathrooms` | Add a restroom (`name`, `lat`, `lng`, optional `review`) |
| `GET` | `/api/bathrooms/:id` | Restroom details and all reviews |
| `POST` | `/api/bathrooms/:id/reviews` | Add a review (`overall`, `cleanliness`, `supplies`, `privacy` from 1 to 5, optional `author` and `comment`) |

## Third-party services

Map tiles are provided by [CARTO](https://carto.com/attributions) using [OpenStreetMap](https://www.openstreetmap.org/copyright) data. Place search uses the OpenStreetMap [Nominatim](https://nominatim.org/) service, which is subject to its usage policy; high-traffic deployments should use a self-hosted or commercial geocoder. Leaflet is bundled under `public/vendor/leaflet` (BSD-2-Clause). The iPhone app uses Apple Maps for its map and Apple's geocoder to fill in addresses.
