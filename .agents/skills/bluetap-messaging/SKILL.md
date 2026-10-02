---
name: bluetap-messaging
description: Preserve BlueTap conversation authority, epoch-bound messaging, immutable sequencing, logical-principal read cursors, bounded history, and server-only chat writes.
---

# BlueTap Messaging

BlueTap V1 supports only these communication relationships:

- `requester_branch`: one Requester and one Branch principal, authorized by a distinct `requester_inquiry`, `active_order`, or bounded `post_order_followup` reason.
- `requester_distributor`: one Requester and the current assigned Distributor for one order and one `assignmentVersion`.
- `distributor_branch`: one Distributor and their current Branch principal for one `branchMembershipVersion`.
- `branch_coordination`: two active Branch principals represented by a canonical sorted branch pair.

There is no Requester-to-Requester chat, personal Manager-to-Manager direct message, global user directory, or normal Admin chat inbox.

## Authority and identity

- Firebase Authentication and the current `users`, `branches`, and `requests` records remain authoritative.
- All conversation, message, unread, participant-state, and read-cursor writes go through Render Node. Firestore clients cannot write them.
- Conversation resolve accepts an intent, never participant arrays or trusted requester, Distributor, epoch, hash, sender, or principal fields.
- Requester/Distributor authority is rebound whenever `assignmentVersion` changes. An old assignment epoch never becomes the new assignment thread.
- Distributor/Branch authority is rebound whenever `branchMembershipVersion` changes.
- Manager send/read actions use the authenticated Manager's current Branch as the logical principal and require the trusted Firebase Manager claim.
- Conversation IDs are opaque. A server-only authority registry uses the canonical authority hash to prevent duplicate conversation creation.
- Every send, read-cursor update, and bounded history read revalidates current account, role, operational, branch, order, epoch, lifecycle, and participant-principal authority. Stored participant arrays alone never authorize a backend action.

## Messages and delivery state

- Normal V1 sends are immutable text messages only, normalized as Unicode text and limited to 2,000 characters.
- `nextSequence` is allocated transactionally. Message creation, sequence increment, safe preview, conversation summary, participant unread state, idempotency record, and persistent rate-limit state commit atomically.
- `clientMutationId` is mandatory and bounded. A server-only mutation registry returns the already committed message for a legitimate retry and rejects reuse with a different body or conversation.
- Conversation previews collapse whitespace and contain at most 140 characters.
- `system` and `order_context` remain reserved for trusted future server use. Normal users can send only `text`.

## Read cursors and receipts

- Read state belongs to logical principals, not devices and not individual Managers acting for a Branch.
- Each participant state tracks `lastReadSeq`, `lastReadAt`, `lastIncomingSeq`, `incomingCount`, `lastReadIncomingCount`, `unreadCount`, and `accessState`.
- Sending never adds unread state to the sender. Every other logical principal increments its incoming and unread metadata transactionally.
- Read cursors advance monotonically and can target only a committed sequence. A cursor never moves backward or beyond `lastMessageSeq`.
- A Manager reading a Branch conversation advances the shared Branch principal cursor.
- UI pending means the send has not committed. One check (`✓`) means BlueTap persisted the message transaction successfully. Two checks (`✓✓`) mean the recipient logical principal has `lastReadSeq >= message.seq`; it does not mean device delivery.

## History and rate limits

- Phase 2 message history is loaded through `GET /api/chat/messages`, newest first, with a default page size of 40 and maximum of 50. Older pages use `beforeSeq`.
- Direct Firestore message reads are allowed only through the parent conversation's Render-maintained participant-access and lifecycle projection. The current account/role, current Manager branch, participant access state, conversation status, and `accessEndsAt` must all permit the read. Direct client message writes always remain denied.
- Persistent Firestore-backed limits are 5 committed new messages per 10 seconds and 30 per minute per authenticated user. Idempotent retries do not consume another allowance.
- Rate-limit records contain bounded recent timestamps and a cleanup timestamp; retention cleanup is not implemented in Phase 2.

## Lifecycle persistence

- Canonical conversation states are `active`, `read_only`, and `closed`. Only Render Node may change lifecycle fields or participant access projections.
- Requester/Distributor conversations remain active for seven calendar days after the trusted `deliveredAt` time. Render persists `accessEndsAt`; server and Firestore reads fail closed when that deadline expires.
- Distributor decline, assignment clearing, reassignment, and Admin dispatch override invalidate the old `assignmentVersion` thread in the same order transaction. A later assignment uses a new authority hash and never reactivates the old thread.
- A transfer request keeps source-branch order authority but immediately invalidates a cleared Distributor assignment. Transfer acceptance removes the source `active_order` reason and adds it for the target Branch; transfer decline grants the target nothing.
- Requester/Branch reasons are independent. Removing `active_order` must not close a conversation while `requester_inquiry` or an unexpired `post_order_followup` reason remains valid.
- A Distributor `branchMembershipVersion` change closes the old Distributor/Branch epoch in the same profile transaction. Same-branch profile and operational edits do not create a new conversation epoch.
- Lifecycle reconciliation updates only existing conversations. New valid assignment, membership, and branch relationships remain eligible for the normal on-demand resolve/create path.
- Terminal order context is a minimal sanitized snapshot only; never copy delivery coordinates or the entire order into chat.

## Realtime frontend

- Requester, Distributor, and Manager role layouts mount one shared `ChatDataProvider` and a floating BlueTap messenger launcher. Chat is not a bottom-navigation or Manager-sidebar destination, and Admin has no general launcher or conversation-summary listener.
- Each mounted operational role owns one private Firestore activity-signal listener (`chatUserActivity/{uid}` or `chatBranchActivity/{branchId}`). It refreshes `GET /api/chat/conversations`, whose server query uses `participantUserUids` or the authoritative `participantBranchIds`, orders by `updatedAt` descending, and bounds candidates to 50. The backend revalidates every returned conversation with the existing read authorizer. A membership-only client query cannot prove per-document lifecycle/access conditions; never relax conversation or message rules to make it pass.
- Resolve, send, cursor advances, and lifecycle reconciliation publish content-free activity signals atomically with their writes. Coalesce refreshes, discard results after cleanup, and refresh once at the nearest access deadline. This is event-driven invalidation, not retry polling.
- Manager pinned contacts come only from the existing own-branch user data. `distributor_branch` may accept a `distributorId` selection from a Manager, but the backend must re-read active Manager claims/profile/branch and the Distributor's current membership. Other roles cannot choose a Distributor for this intent.
- Station conversations can have no order context. Presentation helpers must tolerate null order data, and all station actions remain inside the chat overlay.
- Only the visibly open thread owns a realtime message listener. It reads the newest 40 messages ordered by descending sequence, unsubscribes when the panel closes or the thread changes, and never attaches listeners for every conversation or older page.
- Older history uses the authenticated bounded Render endpoint in pages of 40. Merge realtime, paginated, and optimistic messages by committed ID and sender-scoped `clientMutationId`, preserving stable sequence order without adding historical listeners.
- Firestore is used for private summary invalidation signals and authorized open-thread reads. Summary selection, resolve, send, retry, and read-cursor mutations use the Render chat API.
- Read state advances only while the thread UI is visible and incoming committed messages are presented. Loading summaries, rendering the launcher, or fetching a preview never marks a conversation read; repeated cursor updates are coalesced and never regress.
- A successful read-cursor advance publishes the same content-free participant activity invalidation used by sends. This lets the sender refresh the other principal's `lastReadSeq` and show two seen checks without requiring a reply, while leaving message order and `updatedAt` unchanged.
- Launcher and row unread counts come from the current logical principal's `participantState`, never from scanning message subcollections. Manager unread belongs to the Branch principal, not an individual Manager.
- Optimistic messages retain one `clientMutationId` through failure and retry. Pending shows a spinner, a committed message shows `✓` (sent), and `✓✓` appears only when every other active logical recipient has `lastReadSeq >= message.seq` (seen). These marks never claim physical device delivery.
- Requester order surfaces may open an authoritative `requester_branch` order follow-up and, only while a current assignment exists, a separate `requester_distributor` thread. Distributor order actions may resolve only their currently assigned Requester, while the launcher may resolve the Distributor's current Branch relationship. Manager discovery stays within already authorized operational conversations; there is no global Requester picker.
- Manager conversation lists group current-branch `distributor_branch`, authorized `requester_branch`, and existing `branch_coordination` rows. Distributor lists separate the current `distributor_branch` station row from authorized `requester_distributor` rows. Search filters these existing rows only, and pinned Distributor contacts merge matching conversation metadata instead of duplicating the row.
- `Follow Up` always resolves `requester_branch`; `Message Distributor` always resolves `requester_distributor` for the current assignment. These actions never share or substitute a conversation.
- Summary and thread listeners wait for Firebase auth and authoritative role identity hydration. Manager listeners require the loaded active Manager profile and active current Branch; Distributor listeners require the loaded active profile and operational `branchId`. Hydration is a loading state, not a permission failure.
- `distributor_branch` resolves inside the mounted chat panel. Resolution clears stale thread state and reattaches the one visible thread listener even when the authoritative conversation ID is unchanged.
- Desktop uses an anchored overlay panel without route navigation. Narrow web and native use a safe-area full-height modal. Both presentations use BlueTap semantic light/dark tokens, accessible controls, a compact coordinate-free order context, and the custom water-drop/chat-bubble mark.

## Reports, restrictions, and retention

- Only authenticated Requesters and Distributors may report the opposite user in an authorized `requester_distributor` conversation. The report backend derives the target, branch jurisdiction, order relationship, and safe identity snapshots; never trust client-supplied target or branch fields.
- Report evidence is an immutable snapshot of at most five authorized messages. A message report may reference only an incoming message from the derived target. Report creation is protected by persistent per-reporter rate limits and a ten-minute reporter/conversation/message/category duplicate key.
- Chat restrictions are server-maintained projections in `chatRestrictions/{uid}`. Send authorization checks the active account first, then effective platform or conversation-branch restrictions using server time, before ordinary conversation lifecycle checks. Restricted users retain authorized read and report access.
- Managers may apply only branch chat restrictions for their authoritative branch. Admins may apply platform chat restrictions. Neither role receives a global conversation inbox; Admin expanded review is report-scoped, reason-required, bounded to 20 messages, and audited.
- Ordinary messages follow the configured chat retention period. Open or escalated report evidence, and resolved evidence still inside its configured evidence-retention period, protects referenced source messages from cleanup. Report metadata and moderation/Admin audit records remain protected; cleanup may purge only expired resolved evidence snapshots.

## Current V1 exclusions

Message editing and soft deletion are implemented only through the server-authoritative Phase 4.1 mutation workflow. Do not add unsend, attachments, images, files, voice, reactions, forwarding, typing indicators, presence, push notifications, global search/export, unrestricted discovery, or an Admin chat inbox unless a later approved phase explicitly implements them.

## Phase 4.1 stabilization

- Requester-to-branch general inquiries use the existing `requester_branch` authority with `intent: inquiry`, no order ID, and one reusable authority-registry conversation per Requester and active branch. Managers see the branch-scoped conversation as a general inquiry; no Manager identity becomes a personal participant.
- Message edits and deletes are server-authoritative sender-only mutations within 15 minutes of server `createdAt`. Edits append protected revision history and honor chat restrictions. Deletes use a visible tombstone, preserve sequence/sender/receipts and immutable report evidence, and remain unavailable to suspended or terminated accounts.
- User and message reporting belongs behind three-dot menus. Never expose a permanent red report control or allow reporting one's own message.
