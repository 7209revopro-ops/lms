# Delta Institutions — student mobile app

React Native + Expo (SDK 58) + TypeScript. The plan is [plan.md §13](../plan.md).
Same backend as the website; the app never re-implements a rule.

```
mobile/
  src/app/           Expo Router screens (file = route)
    _layout.tsx      fonts, providers, update/maintenance gate, auth guards
    (auth)/          sign-in · code · two-factor · device
    (tabs)/          home · schedule · learning · messages · profile
  src/lib/           http (Bearer + single-flight refresh), session, auth, device, appConfig
  src/components/    UI building blocks
  src/theme/         the website's colour tokens, light + dark
  src/i18n/          strings — every visible string goes through t()
../shared/           types and pure rules shared with client/ (no dependencies)
```

## Run it

Node **24 LTS** (`.nvmrc`) — React Native 0.88 does not support odd Node releases such as 25.

```bash
cp .env.example .env.local        # set EXPO_PUBLIC_API_URL
npm install
npx expo run:android              # first time: builds and installs the dev app (JDK 17, Android SDK)
npx expo start                    # afterwards: just the JS server
```

On a real phone use this computer's LAN address in `EXPO_PUBLIC_API_URL`
(`http://192.168.x.x:8000/api/v1`); the Android emulator reaches the host at
`10.0.2.2`. The backend must be running (`cd ../backend && bun run dev`).

> The local backend `.env` sends **real** email and WhatsApp. For testing,
> point the app at an isolated backend with those services blanked.

## Checks (run before declaring anything done)

```bash
npm run type-check
npm run lint
npm test
npm run doctor
```

## How sign-in works

- Every request sends `X-Client: mobile`, `X-Device-Id` (32 random bytes, made
  once, kept in the Keychain/Keystore) and a `DeltaLMS/<version> (<model>; <os>)`
  user agent. The server answers sign-ins with tokens in the body and never sets
  a cookie for the app.
- Tokens live only in `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`).
- A 401 triggers ONE refresh shared by every waiting request, with a 15 s
  timeout. Only a 401 from the refresh ends the session; offline, timeouts,
  5xx and 429 keep it.
- A second phone is a new device: the admin approves it on the Devices page,
  like a new browser. The app shows a "waiting for approval" screen.
- `GET /app/config` can force an update or show maintenance without a release.

## Release

EAS profiles in `eas.json`: `development`, `preview` (internal testers),
`production`. `npx eas-cli@latest build --profile preview --platform android`.
