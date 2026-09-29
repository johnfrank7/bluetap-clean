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

## Current V1 exclusions

Do not add message editing, deletion, unsend, attachments, images, files, voice, reactions, forwarding, typing indicators, presence, push notifications, search/export, reports, moderation, retention cleanup, unrestricted discovery, or chat UI under this backend contract unless a later approved phase explicitly implements them.
