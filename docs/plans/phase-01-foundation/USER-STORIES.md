# Phase 01 — Foundation · USER STORIES

> Format: **US-XX** persona · story · acceptance criteria (AC) · edge cases.

## US-01 · Visitor · language
As a visitor, I can switch between Arabic and English without losing my place, so I can browse comfortably.
- AC: switch keeps the current route and filters; direction flips; persisted for next visit.
- Edge: missing translation → falls back to the other language and logs the key; LTR content inside RTL (SKUs, numbers) stays readable.

## US-02 · New customer · register
As a new customer, I create an account with email and phone so I can order later.
- AC: inline validation (valid email, Egyptian phone), password strength shown, terms must be accepted; submit shows loading; success → "Verify your email" screen; 6-digit OTP; resend disabled 60s; verifying signs me in automatically and returns me to what I was doing.
- Edge: email already exists → offer sign-in; wrong code → error with remaining attempts; too many attempts → cooldown message; closing the page keeps the account pending with a resend option.

## US-03 · New customer · Google
As a customer, I sign in with Google in one tap, so I skip the form.
- AC: new Google user is asked for phone + terms once; then lands signed in.
- Edge: Google email already exists → account is linked, no duplicates; canceled popup → no error state, just return.

## US-04 · Returning customer · sign in
As a returning customer, I sign in with email or phone and my password.
- AC: both identifiers work; wrong password shows a generic secure error; success returns to intended page.
- Edge: unverified email → resend verification; blocked account → reason screen with support link.

## US-05 · Customer · forgot password
As a customer, I reset my password using an email OTP.
- AC: enter email or phone → code sent to the account email → 6 digits → new password with confirmation → signed in.
- Edge: expired code → "send a new code"; phone without email → contact support path.

## US-06 · Admin · role management
As an admin, I change a user's role and their access updates immediately.
- AC: role change requires confirmation; audit entry recorded; the user's next request reflects the new permissions.
- Edge: cannot demote the last admin; staff permissions limited to the matrix.

## US-07 · Admin · site identity
As an admin, I edit site name, tagline, favicon and logos per language, and see them applied.
- AC: save with preview; changes appear on public pages after refresh; invalid image rejected before save.
- Edge: missing English logo → falls back to Arabic logo rather than breaking the header.

## US-08 · Super admin · design tokens
As a super admin, I change colors and fonts from settings without a deploy.
- AC: token editor shows grouped sections; save applies on next request; contrast warning if below AA.
- Edge: invalid hex rejected; reset-to-default restores the base theme.

## US-09 · Security · isolation
As a customer, I can never see another customer's profile or address, even by guessing IDs.
- AC: direct API calls blocked by RLS; UI never exposes foreign IDs.
- Edge: staff without permission is also blocked and sees a 403 page, not a broken screen.

## US-10 · Responsiveness · foundation
As any user, I can use every foundation screen on my phone.
- AC: no horizontal scroll at 390; dialogs become full-screen sheets; tables become cards.
- Edge: zoomed text (200%) does not overlap controls.
