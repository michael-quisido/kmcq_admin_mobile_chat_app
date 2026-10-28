# Welcome to your Expo app <img width="40" height="40" alt="waving-hand" src="https://github.com/user-attachments/assets/a7f88be0-674b-4abf-8776-0652ff1eb8e7" />

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).
=======
## KMCQ Admin Chat Mobile App (WebView)

A simple Expo WebView wrapper for the KMCQ admin livechat at `/administrator/livechat`. Restricted to the same origin for auth and livechat routes only.
>>>>>>> 6ec4819 (docs: update README for WebView wrapper)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Ensure the Next.js admin app runs at `http://localhost:3000` (or update `BASE_URL` in `src/app/index.tsx`).

## Development
```bash
npx expo start
```
Open with Expo Go, Android emulator, or iOS simulator.

## Build
Use EAS Build as needed.

## Notes
- Navigation is restricted to auth paths, static assets, and `/administrator/livechat/*`.
- For Android cleartext HTTP in dev, `app.json` includes `usesCleartextTraffic: true`.
- Cookies shared for authentication.
