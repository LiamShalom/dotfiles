---
name: design
description: "Design and build the real UI components for a SideShift feature before its backend exists: real React components on the design system, driven by fixture data, shown on a dev preview route the operator can click through, iterated until approved. Use after brainstorm when a feature has new or changed UI, or when the operator asks to design, mock up, or prototype screens or components ahead of the backend."
---

# Design

The output is approved UI that is production code, not a mockup. The components built here
are the components `execute` wires to real data. Nothing is thrown away.

The operator's rules stay in force and win over this skill: the repo `CLAUDE.md` (reuse rules,
design system, one modal at a time, CTA never disabled for invalid input), `DESIGN_SYSTEM.md`,
`~/.claude/CLAUDE.md`, and agent memory. For a Figma handoff, also use `figma-to-code`.

## Input

The approved spec at `docs/features/<date>-<slug>/spec.md`. If there is no spec, run
`brainstorm` first, or for a small UI ask, write the UI surfaces and states into
`design.md` and confirm them with the operator.

## Steps

1. **Work on the feature branch** in a worktree (operator's worktree rules: link env files,
   clone `node_modules`). This branch is the one `execute` continues on.

2. **Read the taste file and the craft standard, then find the reference.** Read
   `~/dotfiles/claude/references/ui-taste.md` (the operator's design feedback, distilled) and
   `docs/frontend/unslop.md` (the craft standard: nine passes and the signs of
   AI-looking UI), and design to both; taste wins where they differ. Write the three
   direction lines from `unslop.md` (job, moment, signature) into `design.md` before you
   build. For each surface in the spec, open the closest shipped screen the operator
   has approved, note how few words it uses and how it shows state (numbers, chips, icons,
   layout), and list the primitives in `components/ui/` and `components/ui/icons/` you will
   use. A new component composes those primitives and tokens. Creator surfaces (`CREATOR_SURFACES` in
   `eslint.config.mjs`) stay off the design system.

   **Name the shipped surface the ask means before you build.** "Redesign the screens for X" can mean a
   one-time popup about X, the flow X itself, or a page. Write the exact component and where users meet it
   as the first line of `design.md`; if the words fit two surfaces, ask which one with both named. (11-08:
   "redesign the screens for the new sign + oauth flow" meant the creator release popup; I rebuilt the
   in-flow Sign and You're in screens → "Im saying the UI for the informational popup".)

   **Before you pick where a surface lives, check who else is redesigning that page.** Run `ListAgents` and
   `git branch -r --sort=-committerdate | head -30`, and read the `design.md` of any open session or branch that
   touches the same page or flow. Write in `design.md` the host you chose and why. Any peer message about that page
   counts too. (11-07 brief pages: three directions built in the create wizard while the campaign-page redesign
   session had already offered a Brief tab → "it doesnt need to be in the campaign creation, check the other chat".)

3. **Define the data contract first.** Write the props type each component takes: the shape
   the backend must deliver. Put it next to the component, or in the existing domain types
   if the concept is already modelled. This is the handover to `execute`.

4. **Build two or three directions first.** A new screen, flow or modal, or a visible layout
   change, starts as two or three genuinely different directions: a different layout or
   metaphor each, not a colour or spacing tweak, and not a copy of the closest shipped
   component's layout. Build them as variants behind one prop with a switcher on the preview
   route. Skip this only for a small change or when the operator already chose the direction.
   (10-23: one trial checkout copied from the Get started cards → "This is awful… This is
   why I asked for you to provide options.")

   **After a rejected selected direction, check the latest request.** If the operator asks
   for options again, reopen the layout decision: build at least two different compositions
   behind the preview switcher and show them side by side before another selection. An
   earlier direction choice does not waive this step. Reusing the kit alone is not a new
   composition. (11-02 plan welcome: the selected guided view became three gray cards →
   "This is awful too, designb a couple of options and presenmt too me".)

   **Then build the components** in their final location, with props only (no fetching inside
   presentational components). Cover every state: loading, empty, error, populated, long
   content, disabled-because-busy, and each role's variant from the party matrix.

5. **Make a preview route**: `app/dev-<slug>-preview/` with `page.tsx` + `preview.tsx`, copied
   from `app/dev-start-today-preview/`. It 404s outside development and Vercel preview. It
   renders each state from typed fixtures, with a state switcher, inside the same layout
   scope the real page uses (`.design-system-scope` for business pages) so DS styles apply.
   Interactions work locally (open modal, switch tab, submit shows inline error).

   **A section of an existing page is shown inside that page.** When the new UI is a part of a
   shipped screen (a tab, a card, a section of the profile), the operator reviews it in place:
   wire it into the real page as soon as a direction is chosen (real data where it exists, empty
   states where the backend is not built yet), and say up front that the standalone preview is
   only for choosing between directions. (10-27: the profile accounts and best-posts preview →
   "this isnt the entire profile".)

6. **Check it yourself first.** Open the route in the shared agent Chrome
   (`chrome-devtools` MCP, background tab). Screenshot each state at 1280 and 390 wide. A page
   that shows real records (a campaign, a creator, a brand) is checked and shown on an empty one
   and a full one, never only one. (11-09: "we need to be testing and viewing on both an empty
   campaign and a full campaign".) Put
   it beside the reference screen. Go through the "Signs of slop" table in `unslop.md` and
   list every sign you see, then run its nine passes in order (spacing, colour, icons, copy,
   type, layout, details, visuals, motion) across the whole screen until the list is empty
   and its checklist and template check pass. In the copy pass, also read every string on
   screen and delete each one that does not change what the user does next, or that a
   label, number, icon or the layout already says. No screen should carry more words than
   its reference. (10-26: "very text heavy components which often arent neccessray".)

   Then list every kind of content on the screen in each state (videos, creators, the brief
   text, a metric, a listing, an action) and where each one appears. Any kind that appears in
   two places, such as a hero above a card or a rail repeating the main column, keeps the
   bigger one and loses the other before you show anything. (11-07 Overview: "no need to have
   3 creator sections"; 11-08 Brief tab: "theres no need to have brief and examples when we
   have the large UI above".)

7. **Show the operator.** Give the localhost URL and, once pushed, the Vercel preview URL
   (`https://sideshift-web-git-<branch-slug>-side-shift.vercel.app/dev-<slug>-preview`).
   Show the directions from step 4 side by side and say which you would pick and why.
   **Put that comparison on the feature's canvas** (see `visual-companion`, "UI design: the
   canvas first"): screenshot each direction from the preview route at 1280 and 390 wide, and
   the reference screen, and add them as one round with `node
   ~/session-board/scripts/board-canvas.mjs add "<feature>" <round.json> "<what to decide>"`:
   one option per direction with its preview link, the reference as its own option, and your
   pick and why in the round's note. It opens in front of this session's pane. The operator
   answers on the canvas (sticky notes, arrows, sketches over a screenshot) or in chat; before
   you change anything, run `board-canvas.mjs read "<feature>"`, look at the PNG it saves, and
   treat every item with `"by": "you"` as feedback. Each later round is another `add` to the
   same canvas, so the history stays in view. When a choice depends on interaction (a modal
   flow, a hover or form state), put a screenshot of each state in its option. Build a
   clickable local page (`visual-companion`, "Artifact pages first", with
   `~/.claude/bin/page-snapshot.mjs`) only when the operator asks to click through. Do
   not redraw product UI by hand. Keep the preview link beside each direction. Once
   one is chosen, delete the others and iterate on feedback until they approve. **Build the
   chosen option exactly as it was mocked, plus only the changes the operator named.** Never
   carry a treatment over from an option they did not pick, even your own pick. Before showing
   it, put the chosen mock and the built screen side by side and list every difference; each
   one must be a change they asked for. (11-03: picked B, "just logo", and I gave B option C's
   green rings → "whyd you do the circles, I said B".) When the
   operator rejects a piece of UI ("I don't like…", "there should be a better solution"),
   replace it on the preview in the same turn with your best alternative, and put any
   remaining choice behind the switcher; never leave the rejected UI up while you ask
   questions. (10-23: the Ads hub banner stayed up while I asked about rules → "I still
   dont like the yellow banner on ads hub".)

   **Learn from each round.** Every time the operator reacts to UI (rejects, approves, or
   says what feels off), add it to `ui-taste.md` in the same turn: the dated quote under the
   principle it supports, or a new principle if none fits. An approval is a lesson too.
   Commit it to dotfiles. This file is how feedback carries to the next design session.

8. **Write `design.md`** in the feature folder: preview route, components and their props
   types, reused primitives, states, screenshots, and decisions the operator made. Commit the
   components, preview route and `design.md` on the feature branch. Do not open a PR.

## Rules

- No fake backend. Fixtures live only in the preview route; components never import them.
- No new palette, hard-coded colours, or lookalike of an existing component.
- The preview route is removed by `execute` once the real page is verified, unless the
  operator wants to keep it for QA.
