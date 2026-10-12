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
   npm run setup   # first time only: installs dependencies
   npm run phone   # starts the ToiletTime server and the app's dev server
   ```

3. Open the iPhone **Camera** app and point it at the QR code shown in the terminal, then tap the banner to open ToiletTime in Expo Go.
4. Allow location access when asked, so the map can show restrooms near you.

Changes to the code reload on the phone automatically while `npm run phone` is running.

**If the app says "Not connected":** the phone can't reach the server on port 3000 of your computer. Check that both devices are on the same Wi-Fi network (not a guest network), and allow Node.js through your computer's firewall. Expo's `--tunnel` mode only tunnels the app itself, not the server, so use it only with a hosted server (see [Put it online](#put-it-online)).

### In the app

- **Map:** Apple Maps with every restroom pinned and colored by rating. Tap a pin for a preview card, then tap the card for full details.
- **Add a restroom:** tap **Add Restroom** to use your location, or touch and hold anywhere on the map. Search for the business to fill in its details, drag the pin to adjust, then rate it.
- **List:** tap the list button or the search bar to search, filter by place type, and sort by distance, rating, review count or date.
- **Details:** overall and per-category scores, amenities, all reviews, directions in Apple Maps, and a **Review** button to add your own rating.

## Put it online

Hosting the server lets the app work anywhere, not just on your home Wi-Fi, and lets everyone share the same ratings. The setup below is free: [Neon](https://neon.tech) stores the ratings in Postgres and [Render](https://render.com) runs the server and the web app.

1. **Create the database.** Sign up at [neon.tech](https://neon.tech), create a project, and copy its connection string. It looks like `postgresql://user:password@ep-....neon.tech/neondb?sslmode=require`.
2. **Deploy the server.** Sign up at [render.com](https://render.com) with your GitHub account. Choose **New → Blueprint**, pick this repository and the branch that contains `render.yaml`, paste the Neon connection string when Render asks for `DATABASE_URL`, and click **Apply**.
3. **Check it.** When the deploy finishes, open the URL Render shows (for example `https://toilettime.onrender.com`). You should see the ToiletTime web app with the sample restrooms. On first start the server creates its tables and loads the samples automatically.
4. **If your URL is different** from `https://toilettime.onrender.com` (Render adds a suffix when a name is taken), put your URL in `mobile/eas.json` in both places that set `EXPO_PUBLIC_API_URL`.

On Render's free plan the server sleeps after 15 minutes without visits, so the first request after a quiet period can take up to a minute. Paid plans stay awake.

To use Expo Go on any network (any Wi-Fi or cellular) with the hosted server, run:

```bash
npm run phone:online
```

This uses the server address from `mobile/eas.json`. To use a different address, run `npm run phone:online -- https://your-server.onrender.com`. The first time, Expo may ask to install `@expo/ngrok` for the tunnel; answer **yes**. Your computer still needs to run this command while you use Expo Go, because Expo Go loads the app from it.

## Install it on your iPhone with TestFlight

This gives you ToiletTime as a real app with its own Home Screen icon, with no computer needed once it's installed. You can also invite up to 100 people to test it.

You need:
- An [Apple Developer Program](https://developer.apple.com/programs/) membership ($99 per year).
- A free [Expo](https://expo.dev/signup) account. Expo builds the app in the cloud, so you don't need a Mac or Xcode.
- The server online (see above), because the installed app talks to it.

From this folder, run:

```bash
npm run setup            # first time only
npm run ios:testflight
```

The command asks you to log in to Expo and to your Apple developer account. Answer **yes** to the prompts to create the project and let Expo manage the signing certificates. Expo then builds the app (about 15–20 minutes) and uploads it to App Store Connect.

When Apple finishes processing the build (usually 10–30 minutes, and you'll get an email), install it:

1. In [App Store Connect](https://appstoreconnect.apple.com), open **ToiletTime → TestFlight** and add yourself under **Internal Testing**.
2. On your iPhone, install **TestFlight** from the App Store and open the invitation.

To ship an update later, run `npm run ios:testflight` again. The build number goes up automatically.

The app's bundle identifier is `com.jake4759.toilettime`, set in `mobile/app.json`. Change it before your first build if you want a different one; it can't be changed after the app is created in App Store Connect.

## Web app and server

The server and web app need Node.js 18 or later.

```bash
npm install
npm start   # server + web app at http://localhost:3000
npm test    # API tests
```

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DATABASE_URL` | none | Postgres connection string. When set, ratings are stored in Postgres; tables are created and seeded on first start. |
| `DB_FILE` | `data/db.json` | Where ratings are stored when `DATABASE_URL` isn't set. Created on first write, starting from `data/seed.json`. |
| `TRUST_PROXY` | none | Set to `1` behind a proxy such as Render's, so the per-client submission limit uses the real client address. |
| `WRITE_LIMIT` | `30` | Maximum new restrooms and reviews per client every 10 minutes. |

For the mobile app, run `npm run lint` and `npm run typecheck` in `mobile/`.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/bathrooms?q=&type=&sort=` | List restrooms with average ratings |
| `POST` | `/api/bathrooms` | Add a restroom (`name`, `lat`, `lng`, optional `review`) |
| `GET` | `/api/bathrooms/:id` | Restroom details and all reviews |
| `POST` | `/api/bathrooms/:id/reviews` | Add a review (`overall`, `cleanliness`, `supplies`, `privacy` from 1 to 5, optional `author` and `comment`) |

## Third-party services

Map tiles are provided by [CARTO](https://carto.com/attributions) using [OpenStreetMap](https://www.openstreetmap.org/copyright) data. Place search uses the OpenStreetMap [Nominatim](https://nominatim.org/) service, which is subject to its usage policy; high-traffic deployments should use a self-hosted or commercial geocoder. Leaflet is bundled under `public/vendor/leaflet` (BSD-2-Clause). The iPhone app uses Apple Maps for its map and Apple's geocoder to fill in addresses.
