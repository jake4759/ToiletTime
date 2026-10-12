This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## App structure

- Single-screen app: `App.tsx` is the full-screen map. Secondary views (list, restroom details, add restroom) are React Native `Modal`s with `presentationStyle="pageSheet"` in `src/screens/`, which gives native iOS sheets without a router.
- If the app grows to multiple full screens, adopt **Expo Router** (routes in `src/app/`) rather than adding another navigation library.
- Shared UI lives in `src/components/`, the API client in `src/api.ts`. The API server is `../server.js`; `src/api.ts` finds it on port 3000 of the dev machine unless `EXPO_PUBLIC_API_URL` is set.
- Accounts use Supabase Auth (`src/supabase.ts`, `src/auth.tsx`). The app gets the Supabase URL and publishable key from the server's `/api/config`, keeps the session in `expo-secure-store`, and sends the access token to the server, which verifies it with Supabase. Never put the Supabase secret key in the app.
- Only use native modules that ship in Expo Go (see `node_modules/expo/bundledNativeModules.json`), so the app can be tested on a phone without a development build.

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
