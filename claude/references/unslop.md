# Unslop: the craft standard for SideShift UI

Adapted from **unslop** by Damir Sokolovsky ([@heydamir](https://x.com/heydamir),
github.com/heydamir/unslop), licensed CC BY 4.0. Keep this credit in copies and adaptations.
Changes: cut to the SideShift product, mapped to the design system, and ranked below the
operator's own taste file.

Read with `ui-taste.md`. Order of authority when two rules disagree:
operator's words → `ui-taste.md` → `DESIGN_SYSTEM.md` / `app/globals.css` → this file.

## The idea

AI-made UI fails in the same way each time: every surface glows, labels carry emoji, spacing
is whatever got typed, copy shouts. Removing that is half the job. A clean screen that could
belong to any product is the next template.

Slop spreads color and effects over the chrome (backgrounds, buttons, borders, labels). Craft
keeps the chrome quiet and puts the richness into **one or two moments** of real content: a
chart drawn with care, a real video, a big number, the liquid-metal plane.

## Direction (three lines, before you build)

SideShift's palette, type, radii and motion are fixed by the design system. Do not invent new
ones. Write only these three lines for the screen, in `design.md` or in your head for a fix:

- **Job.** What this screen does for whom, in one plain sentence (brand finding creators,
  creator getting paid, agency checking spend).
- **Moment.** The one place that gets color, material and detail, taken from the product: a
  chart in platform colors, a creator's real video, the payout figure, a platform logo row,
  liquid metal or the blue gradient on a hero. Everything else stays neutral.
- **Signature.** One small detail this screen does that only SideShift would, used once.

## The nine passes, in order

Finish a pass across the whole screen before the next. Spacing first, because everything reads
differently once the rhythm is right. Copy before type and layout, because the text length
sets size and place. Visuals and motion last.

1. **Spacing.** 4px grid (Tailwind steps or `--ds-space-*`). Same thing, same size: one row
   height and gap per list, one padding per card row. Space inside a group is smaller than
   space between groups. Icons in one column, labels on one line, numbers right-aligned. No
   one-off values like `mt-[13px]`; 2px nudges inside small controls are fine.
2. **Color.** Surfaces, borders and text come from the `--ds-*` neutrals. Three text roles:
   primary, secondary, tertiary. `--ds-blue` marks the primary action, the selection or the
   one number that matters, not everything. Green and red carry meaning only. No hue
   gradients on surfaces, gradient text, colored glows or shadows, washes or blobs behind
   content, neon borders. Exceptions the operator approved: liquid metal and the blue gradient
   on a hero moment, platform brand colors in charts and logos.
3. **Icons.** No emoji anywhere in the interface. One set (`components/ui/icons/`, else
   lucide), one size and stroke per context, colored by the text role, never their own color.
   Drop icons that add nothing. Platform names get the platform logo (ui-taste 6).
4. **Copy.** Say what the screen does in this product's nouns. No exclamation marks, no
   greeting headlines ("Welcome back, Liam 👋" becomes the page name or the period). Short
   labels: "Search", not "Search anything…". A change says what it compares to: "+12% vs
   last month". No trailing period on titles, labels, buttons. No hype: supercharge,
   seamless, unlock, magic, effortless, revolutionize, game-changing, "AI-powered". No
   invented numbers or claims. Fixture data looks real, never `$123,456` or `[X]`. No "New ✨",
   "PRO", "Beta 🚀" badges unless the product needs one, then quiet text.
5. **Type.** Use the `type-*` classes and DS weights; do not introduce a new family. Hierarchy
   from size and color, not weight. Sentence case: `PAID THIS MONTH` with wide tracking becomes
   `Paid this month`. No negative tracking on small text. `tabular-nums` and one number format
   per screen (`$48,210` beside `$124,860.40` is wrong). No italic for emphasis.
6. **Layout.** Keep the sections and their order. Apps keep app proportions: never shrink a
   page into a narrow centered column. One primary action, at most one secondary next to it.
   Long headings left-aligned. Check 1280 and 390 wide: no dead empty band, no uneven button
   wraps (ui-taste 10).
7. **Details.** Nested radius: inner = outer minus the padding between, minimum 4. Controls
   8 to 12, cards 12 to 16, panels 16 to 20 (`--ds-radius-*`); not everything is a pill. Counts
   and meta are quiet muted text, not glowing pills. Stat cards are a label, a big figure and a
   change with its reference; no sparklines or icons added to fill them. One main chart per
   screen, clearly the largest; other data is smaller and different in kind (a ranked list, a
   short table). One accent per chart, the rest neutral, unless series must be told apart.
   Equal cards in a row with the same content read as a template: vary the widths. Hover and
   visible focus states exist and stay in the palette.
8. **Visuals.** No decorative filler: blobs, orbs, nebulas, glowing grids, robots, brains,
   sparkles for "AI". App screens get their moment from the product (real videos, avatars,
   logos, a chart), almost never a generated image. A hero or empty state shows something
   true: the real product with plausible data.
9. **Motion.** Use the DS motion rules (DESIGN_SYSTEM.md 12b). No looping motion on things
   that are not live (`animate-ping`, breathing glows, shimmer on text; skeleton loaders are
   fine). No `transition-all`: name the properties. No `hover:scale` on cards, no bounce. Never
   animate width, height, top, left or margins. At most one entrance on load.

## Signs of slop (audit list)

Look for each one on the screen and in the diff. Fix it with the pass named.

| Sign | Pass |
|---|---|
| Purple/violet/pink/blue hue gradients on surfaces, buttons, active nav | 2 |
| Gradient text in headings, numbers, logo (DS `type-button-metal` excepted) | 2, 5 |
| Colored glow shadows, `drop-shadow` on emoji, glowing pills | 2 |
| Blurred color blobs or radial washes behind content | 2, 8 |
| Five near-identical tints for text | 2 |
| Every element highlighted so nothing stands out | 2 |
| Glass cards with inner highlight and colored shadow | 2 |
| Emoji as icon, label decoration, status or inside a count | 3 |
| Icons in many sizes and colors, or off the column | 3 |
| ✨ sparkle for anything AI | 3 |
| Arbitrary off-grid values (`mt-[13px]`, `h-[31px]`) | 1 |
| Rows in one list with different heights, siblings with different padding | 1 |
| Greeting headline, `!` or `!!`, hype word, trailing period on a label | 4 |
| Change with no reference (`+12%`) | 4 |
| Fake-looking data or unverified claim ("Loved by 10,000+") | 4 |
| `UPPERCASE` labels with wide tracking | 5 |
| 800/900 headings (DS `type-number` excepted) | 5 |
| Mixed number formats | 5 |
| Everything a full pill | 7 |
| Rainbow bars in one series, glowing bars, uppercase axis labels | 7 |
| Sparklines or mini bars stuffed into every stat card | 7 |
| A row of equal cards with the same chart | 7 |
| A pill badge above a heading ("✨ Introducing…") | 4, 7 |
| Three or more buttons in a hero or footer | 6 |
| `animate-ping`/pulse on things that are not live, `transition-all`, `hover:scale` on cards, bounce | 9 |

## Template check (last)

Swap "SideShift" for a competitor's name. Would the screen still fit? Then push the direction
harder: the copy's nouns, the moment, the signature. Also: does it match the closest shipped
sibling (ui-taste 3)? Craft never overrides reuse.

## Checklist

- [ ] Direction written: job, moment, signature
- [ ] 4px grid; equal things equal; icons, labels, numbers each in one column
- [ ] `--ds-*` neutrals, three text roles, blue used once or twice
- [ ] No hue gradients, gradient text, glows, colored shadows, blobs (approved hero moments aside)
- [ ] No emoji; one icon set; logos for platforms
- [ ] No `!`, greeting, hype, trailing period on labels, unverified claim; changes have a reference
- [ ] DS type classes; sentence case; `tabular-nums`; one number format
- [ ] Nested radii add up; one main chart; stat cards are numbers
- [ ] No looping or bouncy motion; no `transition-all`; no animated layout properties
- [ ] 1280 and 390 checked; template check passed

---

Part of unslop by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0.
