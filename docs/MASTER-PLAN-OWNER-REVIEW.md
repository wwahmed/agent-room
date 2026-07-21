# WakiChat master plan - owner review edition

Status: TEAM DRAFT for live review with Waqas. Companion to
docs/PROGRAM-ROADMAP.md (the full engineering version). This one is written
to be read in five minutes and reviewed section by section in the room.
Nothing here is implemented-by-default: each section ends with the decision
that belongs to you.

## What this plan is

Six programs, in order. Each one exists because of something you personally
hit: deploys that broke the phone while you were using it, duplicate
ClaudeUI identities, the share icon nobody could find, text too small to
read, the chat losing its place when you switch tabs. The order is chosen so
that everything later ships through safety rails built first.

## Program 1 - Release safety (in progress, first because everything rides on it)

**What you get:** you are never again the first person to find a broken
screen. Every change is built once, reviewed on a staging preview, approved
by someone who is not its author, checked by a machine against 110 fixed
screenshots, and only then swapped into live - with a one-command rollback
if anything is wrong. A hotfix lane still exists for your urgent calls, but
it leaves a debt that blocks further releases until the skipped checks pass.

**State:** pipeline and screenshot gate are built and drilled in sandbox;
approval identity needs one small server change (designed, not built); the
first real release through the new lane has not happened yet.

**Your decision:** none beyond roadmap approval - this program is the
prerequisite for everything.

## Program 2 - Identity and people

**What you get:** every participant is exactly one identity. No more
"ClaudeUI (5)". @mentions always reach the right agent, the People screen
tells you truthfully who is alive, stale, or gone, and release approvals
are tied to real identities, not display names anyone can type.

**Your decision:** none structural, but this is where the duplicate-identity
cleanup you asked about lives.

## Program 3 - Room architecture V2

**What you get:** rooms stop being one endless chat. Five room types -
collaboration (like this one), project (focused build; your control room is
a template of this), review, incident, and interview-research; archiving is
something any room does at end of life, not a type. (Plain-language gloss;
the binding definitions live in the V2 spec.) Work is organized as Goal,
then Epics, then Tasks, so you can see WHAT is being built without
scrolling months of transcript.
This room's history moves forward via a continuity capsule - nothing is
lost, and the new room starts clean.

**Your decisions:** approve the five room types; approve the migration
approach (capsule summary carried forward, full history archived and
searchable, not re-imported).

## Program 4 - Phone reliability and reading

**What you get:** the app works on YOUR phone the way a chat app should:
readable text at a size you choose, a composer that stays usable while
attaching or dictating, no more losing the newest messages when you switch
tabs and come back (the bug you reported today - sequenced as the next P0
in the queue, so it may land even before this program formally opens), and
no repeated dictation beeps.

**Your decisions:** the reading-size default (a side-by-side is waiting for
you); and this program needs YOU as the physical device tester before
anything is called done - screenshots cannot prove how it feels in hand.

## Program 5 - Data truth, findability, performance (runs before desktop)

**What you get:** every number on Home is true (unread counts, activity),
search that finds messages and decisions from any room, and the app staying
fast as history grows. Also the server-hang investigation from yesterday.

**Your decision:** none structural, but this order - data truth before the
desktop rework - is the ratified sequence; flip it if desktop pain is worse
for you day to day.

## Program 6 - Desktop workspace (last)

**What you get:** the desktop app becomes a real workspace: switching rooms
does not reload the whole app, panels are resizable, wide screens are used
instead of wasted, and navigation does not lose your place.

**Your decision:** none beyond the ordering choice above.

## Decisions waiting on you right now

1. **Approve or amend this roadmap and its order** (the open question on the
   board, Q-cc79a6bd). Nothing proceeds without it.
2. **Hotfix debt correction**: the record of what the share-icon hotfix
   actually shipped was under-recorded by the old tooling; a verified
   correction is written and waiting for your and the Lead's sign-off.
3. **Reading-size ruling** (Program 4): the 19px-vs-20px side-by-side on
   your phone.
4. **V2 migration approach** (Program 3): capsule-forward, archive-back.
5. **Your availability as physical phone tester** for Program 4 acceptance.

## How the room works from here (already in force)

- One builder, one slice at a time; builder, reviewer, and verifier are
  always three different parties; nobody approves their own work.
- Evidence over claims: every "done" ships with transcripts, screenshots,
  and an independent verification - you have seen this operating today.
- Anything you flag from your own use of the app becomes a P0 incident with
  its own regression test, ahead of feature work.
