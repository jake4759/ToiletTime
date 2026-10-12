# ToiletTime

Find and rate restrooms at stores, restaurants, cafés and other businesses around the world.

ToiletTime has a native app for iPhone and Android (`mobile/`, built with Expo and React Native) and a web app (`public/`). Both talk to the same Node server, so ratings added on a phone show up everywhere. Accounts are handled by [Supabase](https://supabase.com).

## Features

- **World map.** Every rated restroom appears as a pin colored by its average rating. Your own spot is your **Flush Buddy**, a little full-body character you dress up, in a round badge in your favorite color. A circle around you shows the 200 m area where you can review, and places you can review right now get a green ✓.
- **Places already on the map.** Zoom in and nearby restaurants, cafés, stores, gas stations, hotels, and restrooms already mapped in OpenStreetMap (including those inside theme parks, malls and stations) appear with icons. Tap one to rate its restroom; there's nothing to set up first.
- **Add a restroom.** Search for a business to fill in its details, or touch and hold the map to place one yourself.
- **Flush Buddy and the Closet.** Pick skin, hair, hats, glasses, tops, bottoms, shoes and something to hold. Every restroom you review moves you up a level (Newbie, First Flush, Regular, Throne Scout, Porcelain Pro, Royal Flush) and unlocks new items, from a baseball cap after your first review to the Golden Plunger at 25. The app celebrates each unlock.
- **Only rate where you've been.** You can add or rate a restroom if you're within about 200 m of it, or were in the last 24 hours while the app was open. The app quietly notes which restrooms you pass while it's open; only "near this restroom at this time" is saved (not your position) and it's deleted after 48 hours.
- **Detailed ratings.** Overall, cleanliness, supplies and privacy, with an optional written review. Rating a place again updates your earlier review.
- **Accounts.** Sign in with email and password, Apple, or Google. Email addresses are verified with a 6-digit code, and "Forgot password?" sends a code to reset it. Anyone can browse; posting needs a verified account and a username.
- **Profile.** Username, profile picture, your character and level, **My Reviews** (open or delete any of them), change password, sign out, and delete account.
- **Search and filter** by name, city, country or place type; sort by distance, rating, review count or date.
- Light and dark themes, and a layout that works on phones.

## Run it on your phone

You need a computer (Windows, Mac or Linux) with [Node.js](https://nodejs.org) 18 or later, and a phone on the same Wi-Fi.

**On Windows, the easy way:** double-click **ToiletTime.bat**. It opens a menu where you type a number:

| # | What it does |
| --- | --- |
| 1 | Start the app for a phone on the same Wi-Fi |
| 2 | Start the app using the online server (any network) |
| 3 | Update to the newest version |
| 4 | Install or repair (first-time setup) |
| 5 | Connect accounts (paste your Supabase keys; see below) |
| 6 | Sign in to Expo |
| 7 | Open the website on this PC |
| 8 | Show the commands |
| 9 | Put a ToiletTime shortcut on your Desktop |
| 10 | See reported reviews (moderation) |

**With commands instead:**

1. On your phone, install **Expo Go** from the App Store or Google Play, and sign in to it with a free [Expo account](https://expo.dev/signup).
2. In this folder, run:

   ```bash
   npm run setup        # first time only: installs what ToiletTime needs
   npx expo login       # first time only, run inside the mobile folder
   npm run phone        # starts the ToiletTime server and the app
   ```

3. Scan the QR code with your phone's camera (iPhone) or with Expo Go (Android), and allow location access.

Code changes reload on the phone automatically while `npm run phone` is running.

**Getting updates:** run `npm run update`. It downloads the latest version from GitHub, copies it over this folder, and installs anything new. Your settings (`.env`) and locally saved ratings (`data/db.json`) are kept.

**If the app says "Not connected":** the phone can't reach port 3000 on your computer. Make sure both are on the same Wi-Fi (not a guest network), and allow Node.js through your computer's firewall (on Windows, set the Wi-Fi network to **Private**).

## Set up accounts (Supabase)

Accounts, sign-in, email codes and password resets are handled by Supabase, so ToiletTime never stores passwords. The free plan is plenty for friends and family. Until you connect a project, the app works for browsing and shows "Accounts are coming soon" for sign-in.

### 1. Create the project

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Pick a region near you and save the **database password** it asks for.
2. Open **Project Settings → API Keys** and keep the page open. You'll need the **Project URL**, the **publishable** key (older projects call it **anon public**), and the **secret** key (older projects: **service_role**). The secret key can delete accounts, so never share it or put it in the app.
3. On your computer, double-click **ToiletTime.bat** and choose **5 Connect accounts**, or run `npm run configure`. Paste the three values when asked. For the optional database question, see [Put it online](#put-it-online).

### 2. Send branded codes instead of links

The apps verify emails and reset passwords with 6-digit codes. In Supabase, open **Authentication → Emails** and edit two templates. Ready-made, ToiletTime-branded versions are in [`docs/email-templates`](docs/email-templates):

| Template | Subject | Message body |
| --- | --- | --- |
| **Confirm signup** | `Your ToiletTime verification code: {{ .Token }}` | Paste all of `docs/email-templates/confirm-signup.html` |
| **Reset password** | `Your ToiletTime password reset code: {{ .Token }}` | Paste all of `docs/email-templates/reset-password.html` |

Click **Save** on each. Also check that **Authentication → Sign In / Providers → Email** has **Confirm email** turned on.

### 3. Let it email everyone

Supabase's built-in email only reaches your own team's addresses and sends a few emails an hour. To email friends and family, connect a free email service under **Authentication → Emails → SMTP Settings**. For example, [Brevo](https://www.brevo.com) is free for 300 emails a day and doesn't need your own domain:

1. Sign up at Brevo and verify your email address as a sender.
2. In Brevo, open **SMTP & API** and create an SMTP key.
3. In Supabase, turn on custom SMTP and enter: host `smtp-relay.brevo.com`, port `587`, the username Brevo shows, the SMTP key as the password, and your verified email as the sender.

### 4. Sign in with Google (optional)

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**. Under **Authorized redirect URIs**, add `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
2. In Supabase, open **Authentication → Sign In / Providers → Google**, turn it on, and paste the client ID and secret.
3. Under **Authentication → URL Configuration**, add these **Redirect URLs**: your website (for example `https://toilettime.onrender.com`), `http://localhost:3000`, `exp://**` (for Expo Go), and `toilettime://**` (for the installed app).

The **Continue with Google** button appears in the apps as soon as the provider is on.

### 5. Sign in with Apple (optional, iPhone)

In Supabase, open **Authentication → Sign In / Providers → Apple**, turn it on, and under **Client IDs** enter `host.exp.Exponent,com.jake4759.toilettime`. The first ID is for testing in Expo Go and the second for the TestFlight app. The **Continue with Apple** button then appears on iPhones. Apple requires it in any iPhone app that also offers Google sign-in.

## Put it online

Hosting the server lets the app work anywhere and lets everyone share the same ratings. Both services below have free plans.

1. **Database.** Use the Postgres database that comes with your Supabase project. In Supabase, click **Connect**, copy the **Session pooler** connection string, and put your database password in it. Enter it as the database answer in `npm run configure`, or directly in Render below.
2. **Server.** Sign up at [render.com](https://render.com) with your GitHub account. Choose **New → Blueprint**, pick this repository and the branch with `render.yaml`, fill in `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable key) and `SUPABASE_SERVICE_ROLE_KEY` (secret key), and click **Apply**.
3. **Check it.** Open the address Render shows (for example `https://toilettime.onrender.com`). You should see the ToiletTime website. The server creates its tables on first start.
4. **If your address is different** from `https://toilettime.onrender.com`, put yours in `mobile/eas.json` in both places that set `EXPO_PUBLIC_API_URL`, and add it to Supabase's Redirect URLs.

On Render's free plan the server sleeps after 15 minutes without visits, so the first request after a quiet period can take up to a minute. Free Supabase projects pause after a week without any activity; open the dashboard to wake one up.

To use Expo Go on any network with the hosted server, run `npm run phone:online` (menu option 2). The first time, answer **yes** if Expo asks to install `@expo/ngrok`.

## Share it with friends and family

1. **Put the server online** (above). Accounts live in Supabase and ratings in its database, so they're kept through every app update and shared by everyone.
2. **Publish the iPhone app with TestFlight** (below). In App Store Connect, create an **External Testing** group with a **public link** and send that link to people. Apple reviews the first build, usually within a day.
3. **Ship updates** by running `npm run ios:testflight` again. Testers tap **Update** in TestFlight and stay signed in.

Android friends can use Expo Go for now. A standalone Android build needs a Google Maps API key (`android.config.googleMaps.apiKey` in `mobile/app.json`).

## Install it on your iPhone with TestFlight

This gives you ToiletTime as a real app with its own Home Screen icon. You need an [Apple Developer Program](https://developer.apple.com/programs/) membership ($99 per year), a free [Expo](https://expo.dev/signup) account, and the server online.

```bash
npm run setup            # first time only
npm run ios:testflight
```

The command asks you to log in to Expo and to your Apple developer account. Answer **yes** to create the project and let Expo manage signing certificates. Expo builds the app in the cloud (about 15–20 minutes) and uploads it to App Store Connect. When Apple finishes processing it (you'll get an email), add yourself under **TestFlight → Internal Testing**, then install it with the **TestFlight** app.

The bundle identifier is `com.jake4759.toilettime` (in `mobile/app.json`). Change it before your first build if you want a different one; it can't be changed afterwards.

## Server and website

```bash
npm install
npm start   # server + website at http://localhost:3000
npm test    # automatic checks
```

Settings come from environment variables or a `.env` file in this folder (`npm run configure` writes one; it's never uploaded to GitHub).

| Variable | Default | Description |
| --- | --- | --- |
| `SUPABASE_URL` | none | Supabase project URL. Without it, sign-in is off and the app is browse-only. |
| `SUPABASE_ANON_KEY` | none | Supabase publishable (anon) key. Public by design; the apps use it to sign in. |
| `SUPABASE_SERVICE_ROLE_KEY` | none | Supabase secret (service_role) key. Server only; needed to delete accounts. |
| `DATABASE_URL` | none | Postgres connection string. Without it, ratings are kept in `data/db.json`. |
| `PORT` | `3000` | Port to listen on |
| `TRUST_PROXY` | none | Set to `1` behind a proxy such as Render's, for HTTPS redirects and per-client limits. |
| `WRITE_LIMIT` | `30` | New restrooms and reviews allowed per client every 10 minutes |
| `PROFILE_LIMIT` | `30` | Profile changes (username, picture) per client every 10 minutes |
| `PLACES_LIMIT` | `300` | Nearby-places lookups per client every 10 minutes |
| `OVERPASS_URL` | public servers | OpenStreetMap Overpass endpoints for nearby places (comma-separated) |
| `CONTACT_EMAIL` | none | Contact address shown in the Terms, Privacy Policy and the app's "Contact support" |
| `VISIT_RADIUS_M` | `200` | How close (in meters, plus the phone's GPS accuracy up to 100 m) you must be to a restroom to count as being there |
| `REVIEW_WINDOW_HOURS` | `24` | How long after being near a restroom you can still rate it. Visit records are kept for twice this, at least 48 hours; update the Privacy Policy if you change it. |
| `VISIT_LIMIT` | `200` | Visit updates per client every 10 minutes |
| `HIDE_AFTER_REPORTS` | `3` | Reports from different people that hide a review automatically |

For the app, run `npm run lint` and `npm run typecheck` in `mobile/`.

## API

Requests that need an account send the Supabase access token as `Authorization: Bearer <token>`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/config` | Supabase URL and publishable key for the apps (or `null` when accounts are off), the contact email, and the review `rules` (radius and time window) |
| `GET` | `/api/places?south=&west=&north=&east=` | Unrated businesses and mapped restrooms in an area (at most about 7 km across) |
| `GET` | `/api/bathrooms?q=&type=&sort=` | Rated restrooms with average scores |
| `GET` | `/api/bathrooms/:id` | A restroom and its reviews |
| `POST` | `/api/bathrooms` | Add a restroom (`name`, `lat`, `lng`, optional `osmId`, optional `review`, `here`). Needs a verified account with a username. Returns `rewards`. |
| `POST` | `/api/bathrooms/:id/reviews` | Add or update your review (`overall`, `cleanliness`, `supplies`, `privacy` from 1 to 5, optional `comment`, `here`). Returns `rewards`. |
| `GET` | `/api/visits` | Restrooms (`restroomIds`) and map places (`osmIds`) you were near in the last 24 hours |
| `POST` | `/api/visits` | Note which nearby restrooms you're at (`lat`, `lng`, `accuracy`, `restroomIds`, `places: [{osmId, lat, lng}]`) |
| `GET` | `/api/character` | The Closet: every item, what unlocks it, colors and levels |
| `DELETE` | `/api/reviews/:id` | Delete one of your reviews |
| `POST` | `/api/reviews/:id/report` | Report a review (`reason`: `spam`, `offensive`, `false`, `private` or `other`) |
| `GET` | `/api/me` | Your profile, character, level, review count, email and verification status |
| `PATCH` | `/api/me` | Change `username`, `markerColor` or `character` (only unlocked items) |
| `PUT` / `DELETE` | `/api/me/avatar` | Upload (`image`: base64 JPEG or PNG) or remove your profile picture |
| `GET` | `/api/me/reviews` | Your reviews |
| `DELETE` | `/api/me` | Delete your account; your reviews stay without your name |
| `GET` | `/api/avatars/:userId` | A profile picture |

## Security

- **Accounts are managed by Supabase.** Passwords are salted and hashed by Supabase and never touch this server. Email verification, password-reset codes, Apple and Google sign-in, session expiry and refresh are all handled by Supabase Auth.
- **Every request is checked.** The server verifies each Supabase access token with Supabase before allowing any change, and only lets people delete their own reviews.
- **Secure token storage.** On phones, sign-ins are kept in the iOS Keychain or Android Keystore (`expo-secure-store`), never in plain storage.
- **Encrypted in transit.** The hosted server uses HTTPS, redirects plain HTTP, and tells browsers to stay on HTTPS (HSTS). Supabase and its database are only reached over TLS.
- **Abuse limits** on posting, profile changes and map lookups, per client.
- **Injection and XSS.** Database queries are parameterized, input is validated and length-limited, uploads must be real JPEG or PNG images, and the website escapes everything people write. A strict Content Security Policy blocks injected scripts and framing.
- **Account deletion** is built in, as Apple requires, and removes the account from Supabase.

`npm audit` in `mobile/` reports issues only in Expo's build tools that run on your computer, not in the app or the server.

## Legal and safety

ToiletTime includes the basics that apps with accounts and user reviews are expected to have, and that Apple requires for apps with user-generated content. This isn't legal advice; have a lawyer review things if the app grows, makes money, or you get a legal complaint.

**Built in**

- **Terms of Service** (`/terms`) and **Privacy Policy** (`/privacy`), linked from the sign-up screen, the profile and the website. Run `npm run configure` (menu option 5) and enter a **contact email**; it's shown in both documents and in the app's "Contact support". The Terms are written for an individual operator in Texas; edit `public/terms.html` and `public/privacy.html` if that changes.
- **Agreement at sign-up**: creating an account requires confirming you're 13 or older and agree to the Terms and Privacy Policy.
- **Reporting and blocking**: anyone signed in can report a review, and anyone can hide a person's reviews. Reviews reported by 3 different people (`HIDE_AFTER_REPORTS`) are hidden automatically.
- **Word filter**: strong profanity and slurs are starred out in reviews and not allowed in usernames.
- **Moderation**: menu option 10 or `npm run moderate` lists reported reviews; `npm run moderate -- delete <id>` removes one and `npm run moderate -- restore <id>` keeps it. Check reports regularly; Apple expects reports to be acted on within 24 hours.
- **Account deletion** inside the app, as Apple requires.
- **Attribution**: OpenStreetMap credit next to place data, as its license requires.

**Before you publish with TestFlight or the App Store**

1. In App Store Connect, set the **Privacy Policy URL** to `https://YOUR-SERVER/privacy` and the **Support URL** to your website.
2. Fill in **App Privacy** honestly. For ToiletTime as built: *Contact Info: Email Address* (app functionality, linked to the user); *User Content: Photos and Other User Content* (app functionality, linked to the user); *Identifiers: User ID* (app functionality, linked to the user); *Location: Coarse Location* (app functionality, not linked, because the visible map area is sent to find nearby places). No tracking, no ads.
3. In the **age rating** questionnaire, say the app has user-generated content.
4. In the review notes, explain the report, hide and moderation features, and give Apple a test account.

**Worth doing as the app grows**

- Search the name "ToiletTime" in the [USPTO trademark database](https://www.uspto.gov/trademarks/search) to make sure nobody else owns it.
- Consider forming an **LLC** so the app's legal risks are separate from your personal assets, and publish the Terms under its name.
- If people may post others' copyrighted photos, register a **DMCA agent** with the U.S. Copyright Office (a small fee) to get the legal "safe harbor" for copyright complaints.
- In the U.S., Section 230 generally protects apps from liability for what their users post, but it doesn't cover what you write yourself. Respond to reports and legal requests promptly.

## Third-party services

Map tiles on the website are from [CARTO](https://carto.com/attributions) with [OpenStreetMap](https://www.openstreetmap.org/copyright) data; the phone app uses Apple Maps on iPhone and Google Maps on Android. Nearby places come from OpenStreetMap through the [Overpass API](https://overpass-api.de/), cached on the server for an hour. Business search uses OpenStreetMap [Nominatim](https://nominatim.org/), which is subject to its usage policy. Accounts use [Supabase](https://supabase.com). Leaflet and supabase-js are bundled under `public/vendor/`.
