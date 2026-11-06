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
   (`chrome-devtools` MCP, background tab). Screenshot each state at 1280 and 390 wide. Put
   it beside the reference screen. Go through the "Signs of slop" table in `unslop.md` and
   list every sign you see, then run its nine passes in order (spacing, colour, icons, copy,
   type, layout, details, visuals, motion) across the whole screen until the list is empty
   and its checklist and template check pass. In the copy pass, also read every string on
   screen and delete each one that does not change what the user does next, or that a
   label, number, icon or the layout already says. No screen should carry more words than
   its reference. (10-26: "very text heavy components which often arent neccessray".)

7. **Show the operator.** Give the localhost URL and, once pushed, the Vercel preview URL
   (`https://sideshift-web-git-<branch-slug>-side-shift.vercel.app/dev-<slug>-preview`).
   Show the directions from step 4 side by side and say which you would pick and why.
   **Put that comparison on an Artifact** (see `visual-companion`, "Artifacts first"): one
   page with a screenshot of each direction from the preview route at 1280 and 390 wide, the
   reference screen beside them, your pick at the top, and the preview link for each. Open it in
   the Session Board pane with `board-browser.mjs`. Republish the same file each round, so the
   operator keeps one URL. The screenshots come from the real components; never redraw product
   UI in the artifact's HTML. The preview route stays where the operator clicks through it. Once
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
