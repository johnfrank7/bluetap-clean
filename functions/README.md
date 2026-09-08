# BlueTap email OTP Functions

This isolated Firebase Functions backend owns email OTP generation and verification.

## Required Firebase secrets

Set these against the Firebase project before deploying:

```powershell
npx firebase-tools functions:secrets:set EMAIL_PROVIDER_API_KEY --project bluetap-cce88
npx firebase-tools functions:secrets:set EMAIL_FROM_ADDRESS --project bluetap-cce88
npx firebase-tools functions:secrets:set EMAIL_OTP_HASH_SECRET --project bluetap-cce88
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
An explicit deny does not override another matching allow rule. Remove or narrow any
broad wildcard allow rules that would also grant access to this collection before deploying.

## Deployment troubleshooting

Deploying the Expo app to Vercel does not deploy these Firebase Functions.
Sign in using `npx firebase-tools login` before running the commands above.
The client calls the default `us-central1` region in project `bluetap-cce88`.
If the function URL returns HTTP 404, deploy the backend to that project and region;
adding browser CORS workarounds will not create the missing function.
The Resend API key and verified sender must be configured before any email can be sent.
The recipient can use Gmail; Gmail is not the outbound email provider in this integration.
