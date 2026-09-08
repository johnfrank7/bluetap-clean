# BlueTap email OTP Functions

This isolated Firebase Functions backend owns email OTP generation and verification.

## Required Firebase secrets

Set these against the Firebase project before deploying:

```powershell
firebase functions:secrets:set EMAIL_PROVIDER_API_KEY
firebase functions:secrets:set EMAIL_FROM_ADDRESS
firebase functions:secrets:set EMAIL_OTP_HASH_SECRET
```

- `EMAIL_PROVIDER_API_KEY`: a Resend API key.
- `EMAIL_FROM_ADDRESS`: a verified Resend sender, for example `BlueTap <verify@yourdomain.com>`.
- `EMAIL_OTP_HASH_SECRET`: a long random secret used only to HMAC OTP values. Generate it with a password manager; never expose it to Expo or the browser.

Install and deploy:

```powershell
cd functions
npm install
cd ..
npx firebase-tools deploy --only functions --project bluetap-cce88
```

## Firestore security

Clients must not read or write `emailOtpVerifications`. Add this deny rule to the project's existing Firestore rules without replacing its current application rules:

```
match /emailOtpVerifications/{verificationId} {
  allow read, write: if false;
}
```

The Firebase Admin SDK used by these functions bypasses Firestore rules and retains access.
