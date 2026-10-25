# BlueTap — Mobile Push Notification Architecture & Feasibility Analysis

**Document Version:** 1.0
**Target Milestone:** Post-Phase 4 Production Hardening
**Target Roles:** Requester, Distributor, Branch Manager, Administrator
**Security Classification:** BlueTap Internal Technical Documentation

---

## 1. Executive Summary

BlueTap currently employs real-time Firestore listeners (`RoleNotifications.jsx`, `useManagerNotifications`, `useRequesterData`, `useAssignedDistributorOrders`) and in-app banner components (`TopToastFeedback.jsx`, `SoftStatusBadge.jsx`) to keep users synchronized with order states, branch dispatch assignments, chat messages, and moderation actions.

While this real-time WebSocket architecture provides instantaneous updates when the application is active in the foreground, mobile users on iOS and Android require background notification delivery when the application is minimized, backgrounded, or terminated.

This document defines the architectural blueprint, security boundaries, credential provisioning, and implementation strategy for integrating native push notifications via **Firebase Cloud Messaging (FCM)** and **Apple Push Notification service (APNs)** using Expo Application Services (EAS).

---

## 2. Current Notification Landscape vs. Native Push

| Dimension | Current BlueTap In-App Model | Native Push Target Model |
| :--- | :--- | :--- |
| **Active States** | Foreground application sessions only | Foreground, Background, and Terminated states |
| **Delivery Mechanism** | Direct Firestore snapshot listeners (`onSnapshot`) | FCM HTTP v1 / APNs binary provider via Firebase Admin |
| **Network Footprint** | Active persistent connection per open tab/app | Push service maintains low-power device radio connection |
| **Deep-Linking** | In-app React state navigation (`replaceOnce`, `navigateOnce`) | OS notification intent payload routing to Expo Router paths |
| **Battery Impact** | Moderate when running continuously | Minimal (delegated to OS push daemon) |
| **Dependencies** | `firebase/firestore`, `@react-native-async-storage` | `expo-notifications`, `expo-device`, Firebase Admin SDK |

---

## 3. System Architecture & Component Interaction

```
  +-----------------------------------------------------------------------+
  |                          BlueTap Client App                           |
  |  - Registers with OS Push Service (APNs / FCM)                        |
  |  - Receives Device Push Token                                         |
  |  - Stores Push Token in Firestore: `users/{uid}/pushTokens/{tokenId}` |
  +-----------------------------------+-----------------------------------+
                                      |
                                      v
  +-----------------------------------------------------------------------+
  |                   Authoritative State Transition                      |
  |  - Manager dispatches order / Distributor advances lifecycle          |
  |  - Event written to `/requests/{requestId}`                           |
  +-----------------------------------+-----------------------------------+
                                      |
                                      v
  +-----------------------------------------------------------------------+
  |                     Server Push Dispatch Engine                       |
  |               (Cloud Functions or Render Node Backend)                |
  |  - Triggers on order document update                                  |
  |  - Resolves target recipient UID (`requesterId` / `distributorId`)    |
  |  - Queries active push tokens for target user                         |
  |  - Enforces payload sanitization (no PII, no credentials)             |
  |  - Invokes `admin.messaging().sendEachForMulticast()` via FCM HTTP v1 |
  +-----------------------------------+-----------------------------------+
                                      |
                +---------------------+---------------------+
                |                                           |
                v                                           v
  +---------------------------+               +---------------------------+
  |        Apple APNs         |               |        Google FCM         |
  | (iOS Production / Sandbox)|               |       (Android OS)        |
  +-------------+-------------+               +-------------+-------------+
                |                                           |
                +---------------------+---------------------+
                                      |
                                      v
  +-----------------------------------------------------------------------+
  |                         Target User Device                            |
  |  - OS presents high-contrast banner with sound/vibration              |
  |  - User tap opens app -> `addNotificationResponseReceivedListener`    |
  |  - Single-flight navigation safely routes to order or chat screen     |
  +-----------------------------------------------------------------------+
```

---

## 4. Platform Provisioning & Credentials

### 4.1 Apple Push Notification service (APNs) — iOS
1. **Apple Developer Account Configuration**:
   - Create an **APNs Key** (.p8 file) in the Apple Developer Portal with the *Apple Push Notifications service (APNs)* capability enabled.
   - Record the `Key ID` (10-character identifier) and `Team ID`.
2. **Firebase Project Binding**:
   - In Firebase Console > Project Settings > Cloud Messaging > Apple app configuration:
     - Upload the `.p8` Authentication Key.
     - Provide the Key ID and Team ID.
     - Specify the iOS Bundle Identifier: `com.bluetap.app`.
3. **Expo EAS Configuration**:
   - In `app.json`, register the iOS notification entitlement:
     ```json
     "ios": {
       "supportsTablet": true,
       "bundleIdentifier": "com.bluetap.app",
       "entitlements": {
         "aps-environment": "production"
       }
     }
     ```

### 4.2 Firebase Cloud Messaging (FCM) — Android
1. **FCM HTTP v1 API Activation**:
   - BlueTap's existing `firebase-admin` server integration connects directly via Google Cloud Service Account credentials (`GOOGLE_APPLICATION_CREDENTIALS`).
   - Enable the **Firebase Cloud Messaging API** in Google Cloud Console.
2. **Client Configuration**:
   - Place `google-services.json` in root directory.
   - Configure Android Notification Channels with appropriate importance levels:
     - `orders`: High importance, sound enabled, priority alert for live delivery milestones.
     - `chat`: High importance, conversation category for in-flight messaging.
     - `system`: Default importance for account updates, schedule confirmations, and reports.

---

## 5. Security & Privacy Safeguards (Fail-Closed Design)

1. **Zero Plaintext PII in Push Payloads**:
   - Push notifications traverse third-party relay infrastructure (Apple, Google, cellular carriers) and can appear on locked device screens.
   - **Strict Rule:** Never include customer phone numbers, complete residential addresses, financial payment details, or authentication OTPs in notification titles, bodies, or payloads.
   - Example sanitized payload:
     ```json
     {
       "notification": {
         "title": "Water Delivery Dispatched 🚚",
         "body": "Your order #REQ-8821 is out for delivery with your assigned distributor."
       },
       "data": {
         "type": "ORDER_LIFECYCLE",
         "orderId": "REQ-8821",
         "targetRoute": "/requester/r_request"
       }
     }
     ```
2. **Token Vault Ownership & Multi-User Isolation**:
   - Tokens must be stored under `users/{uid}/pushTokens/{tokenId}` with Firestore Security Rules restricting write access strictly to `request.auth.uid == uid`.
   - On logout (`signOutAndClearSessions()`), the client must delete its local token record in Firestore before clearing session storage to prevent notification delivery to subsequent users of shared family or station devices.
3. **Stale Token Pruning**:
   - The server dispatch handler must inspect response error codes (`messaging/invalid-registration-token`, `messaging/registration-token-not-registered`).
   - Any unregistered tokens must be purged immediately from the user's `pushTokens` subcollection to prevent dead-token amplification.

---

## 6. Implementation Specification (Phase B)

### 6.1 Client Installation
```bash
npx expo install expo-notifications expo-device
```

### 6.2 Token Registration Utility (`services/pushNotificationService.js`)
```javascript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { auth, db } from '../firebase';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { getInstallationId } from './installationId';

export async function registerForPushNotificationsAsync() {
  if (!Device.isDevice) {
    return { token: null, error: 'Push notifications require physical devices.' };
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return { token: null, error: 'Push notification permission was denied.' };
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  // Persist to user pushTokens collection if authenticated
  const currentUser = auth.currentUser;
  if (currentUser?.uid && token) {
    const installationId = await getInstallationId();
    await setDoc(doc(db, 'users', currentUser.uid, 'pushTokens', installationId), {
      token,
      platform: Platform.OS,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  return { token, error: null };
}

export async function unregisterPushNotificationTokenAsync() {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) return;
  try {
    const installationId = await getInstallationId();
    await deleteDoc(doc(db, 'users', currentUser.uid, 'pushTokens', installationId));
  } catch (err) {
    console.warn('Failed to unregister push token:', err);
  }
}
```

---

## 7. Conclusion & Next Steps

Integrating native push notifications according to this specification will deliver complete, real-time background engagement for Toledo City water refilling operations while upholding BlueTap's core architectural tenets:
- **Role Isolation & Branch Scoping**
- **Zero Client Trust & Fail-Closed Authority**
- **Strict Privacy & Sanitized Ephemeral Payloads**

The migration path is ready for execution as soon as physical testing devices and Apple Developer credentials are provisioned for build pipeline deployment.
