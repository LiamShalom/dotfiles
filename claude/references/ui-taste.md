# Liam's UI taste

Read before designing or changing any SideShift UI. Distilled from ~85 of his reactions to UI
(2026-09-25 to 2026-10-26). Add to it every time he reacts to UI: dated quote under the
principle it supports, or a new principle. Approvals count too.

## Before you show anything, check

1. Could a number, logo, icon, chip or the layout say this instead of a sentence? Then cut the sentence.
2. Is there a banner, notice, callout or yellow box? Delete it.
3. Does it look like the closest shipped sibling (analytics, messages inbox, campaign cards)?
4. Is the most important value big and first, and the rest hidden behind a dropdown or hover?
5. Does any error appear where a prompt, a queue or a link would do the job?
6. Is it one weak pattern copied, or two or three real directions?
7. Is a screenshot attached with "remove that row"? It is the row his sentence just named, never something he asked for earlier (10-29: removed "Profile complete" when he meant the handle).

## Principles (strongest first)

**1. Cut text. Show it with a visual, icon or logo.** He reads text-heavy UI as unfinished.
Long values get a copy button, not the value. An action that fits as an icon is an icon.
- 11-08 open joining brand email: after "It feels very wordy still" I cut it to a quarter; he replied "No I think all the informatino was good and usefull it just needs different size text etc to look more organized". "Wordy" on content he already approved means a flat wall of same-size paragraphs, not too much information: keep the content and add hierarchy (tiles with a bold title and smaller muted body, a two-row before/now table, one big number, compact rows). Cut content only when he says something is unnecessary. Ask "cut or restructure?" only if neither reading fits.
- 10-26 "very text hgeavy components which often arent neccessray"
- 10-06 "I dont like this wordy UI" · 10-07 "this modal is wayy too wordy"
- 10-08 "Theyre wait too wordy and hard to follow for creators" (Google Ads creator screens)
- 10-06 "theres just no point having the actual text I think a copy button is enough since its long"
- 10-25 "message would just become the icon instead of cramming the text"
- 10-15 "collapse their xp level into just the icon, no words" · 10-05 "bring back the mertcis just with only the icons and not the text"
- 10-23 "you dont need the small text simply [tiktok logo] TiktOk Spark Ads Connect Tiktok button"
- 10-29 Discover creator card, narrow tile showing Invite as a bare "+": "invite button should be a message icon". An icon-only action uses the icon of what it does (inviting = sending a message), never a generic +
- 10-26 onboarding call popup, title + bonus checklist + Skip / I've booked over an embedded calendar: "Can we just remove that popup thing, it looks bad". Shipped as the bare calendar with an x

**2. No banners, notice blocks or callouts, yellow above all.** Not for empty states, not for
caveats, not for "no page selected". Fix the state in the UI itself.
- 09-30 "remove any other large notice blocks… These are terrible UI and should not be displayed."
- 10-05 "this huge yellow box is not helpful" · 10-16 "I dont like the yellow banner when no page selected"
- 10-15 "remove this banner from appearing all the time" · 10-23 "I still dont like the yellow banner on ads hub"

- 11-04 Build Ads picker: "Lets put the ready button back to match the launched button". Ready is a green pill on the right, with the same size and responsive position as Launched; Ready uses a checkmark, Launched uses a rocket (11-04 follow-up). Spend stays below the creator. This replaces the 10-30 Ready placement preference.

- 10-30 Build Ads Setup: hide the campaign budget summary for an existing campaign; show it only for a new campaign.

**3. Match the existing design system and the closest sibling surface.** Analytics is the
reference for metrics, charts, stat icons (liquid-metal grey) and platform pills. A Figma, or
the other platform's app (iOS to web), is for content and structure, not a new visual language.
- 11-03 returning terminated applicants: "Use the same UI as the private/incorrect handle but it be ytellow". Use the existing handle-warning chip, tooltip and decision-card treatment in yellow, rather than a generic badge or an extra table row. For this warning, use "Removed before" and "Previously removed from this campaign"; the operator rejected "Terminated".
- 11-05 ad copy Suggest (#8776): "one button for all the fields ... the standard across all platforms", then "the suggest button applies to all, but the options and the refresh are per copy section". One Suggest pill in the Copy header fills every field; each field keeps its own in-field ‹ 1 of 2 › and refresh. A shared trigger does not mean shared flip controls.
- 10-30 Meta copy actions: "make the suggest buttons pop" and mimic Pull earlier in the flow. Share the Pull control's compact pill and trailing provider mark; give Suggest blue emphasis.
- 10-30 Meta copy suggestions: "Make it feel like sidekick inspired. Use the existing compolnents for the bhutton etc". Use Sidekick's shared artifact surface and existing DS buttons for inline copy suggestions, with divider rows instead of nested cards.
- 09-27 "match the elegance as the rest of the dashboard" · 10-14 "It doesnt fit with the design system for this page"
- 10-02 "use the same component as the analytics page where the social platforms are pills underneath the chart"
- 10-20 "your mistake was copying the figma precisely it should be using the same design systme"
- 10-17 winner rules "uses a different UI from the automation rules whihc needs to be standardized"
- 10-26 "why does inherited audience have differing UI across platforms"
- 10-27 guest contract redlining (a non-account guest's page, built on the creator-side stock workspace): "This is very good. I will only say the UI needs some work and I'd appreciate if it used the same design system and components as from the brand side. Make the platforms use the logo etc. Ensure it all is elegant and aligned with the current site's design." A new public page reached from a brand's action gets the business DS and the brand side's components, even when the person on it is creator-like
- 10-28 talent manager's Invite influencer popup, built with the brand modal and black buttons because it mirrored the admin Discover invite: "this design is following the brand side. This is creator side so it should follow that design". A popup opened from the creator app uses the creator kit (creator-buttons.ts), even when a brand-side popup has the same job
- 10-28 brand contract review (track-changes side panel): "the changes you make need to appear on the right side as white. The changes made from the person sending would appear as blue and then once resolved should hide" + "this entire feature should be made using existing design system to ensure that it is seamless with the existing UI/UX" + "add the person who left the comment so that if multiple people left comments it could be tracked". A review panel lists BOTH sides' changes (other side blue, own white), decided items leave the list, every comment names its author
- 10-27 creator web redesign (#7581), first build cloned the iOS chrome onto the web (glass headers, floating tab bar, side menu, rounded font): "We lost the UI from the original creator side web" · "Im mainly wanting you to take the design choices made on the ios and migrate them over while keeping the UI kit and nav from the original web version" · "keep the larger groups and simply have tabs within so the navbar doesnt become scrollable". Picked: five nav groups on the original sidebar and bottom bar, the rest as tabs inside pages

**4. Visual over tabular. Charts and analytics must look good.** A plain list of numbers where
Meta and TikTok have charts reads as "awful". Bars fill the width with small gaps; heatmap
numbers sit inside the squares; platform colours match the platform.
- 10-20 "This youtube analytics is awful: It should be visual like meta and tiktok"
- 10-01 "The chart looks comletely awful… ensure it uses the same colors as the platforms are."
- 10-02 "the bars should be as wide as the timeline allows… with only small gaps inbetween"
- 11-07 smart CPM pay chart drawn on log-log axes (the taper became two straight lines): "Im so confueds, I thought smart should be a line thats surved like log is?". Draw a curve the way he pictures it: plain linear axes, so a taper reads as a line bending over. A log axis is an analyst's trick; don't use one in product UI to make a shape "clearer". Same day, after the full-rate default moved to 500K on a 2M axis (a kink, not a curve): "but I thought the point fo smart was for it to be almost logarithmic". Size the axis so the feature's shape fills it (here 0–10M), and re-check the picture after every default change. 11-08, the corner where "full rate up to N" met the taper: "isnt it supposed to be a curve, on the grpahs youre showing it just shows a cut". When he says curve he means one smooth line with no corner; don't bolt a curve onto a straight segment
- 11-07 smart CPM pay chart, approved: "A" = the fields, then one card with the chart and three priced readouts under it (pay at 100K / 1M / 10M, the flat cost muted below each), over a drag-the-curve chart-first layout and a big-single-number layout. Chart plus exact numbers beats direct manipulation or one hero figure for money terms

**5. Big number first, short cards, secondary data hidden.** He prefers one large number to a
pill, a short card to a tall one, and "show more" to everything at once.
- 11-07 campaign Overview built as the full Analytics dashboard (Top Creators + Active Creators + recommendations + an applicants queue): "no need to have 3 creator sections in the overview. I'd rather the overview be simple and readable. Take inspo from Trybe". An overview shows each kind of thing once: one chart, one ranked list of creators, one of videos. Embedding a whole shipped page is not reuse when it carries that page's density; compose the overview from Home's cards instead.
- 10-30 Meta copy suggestions: "only needs to generate a couple", clarified as "actually generate new copy based on their existing ads". Generate exactly two primary texts and two headlines; retain both options after selection, with no Load more.
- 10-15 "I dontl ike the pill, I like the big number the A had"
- 10-21 "the profile card is a little bit too long… highlighted more of the neccessary content"
- 09-30 "simplified to show most important values and then have a dropwdown to show more"
- 09-30 small grey metric text: "I wish this could just be hidden for the most part"
- 10-26 creator referral page: "Gain inspiration from robinhood who puts a big number and encourages people to get a ton of referrals in order to meet that" (one aspirational number, then a milestone ladder)
- 10-26 $74.75 a month per brand: "can you round the numbers up. starter should be 75", then "make those the actual values" (round numbers, and the payout changed to match rather than the page rounding)

**6. Logos beat labels.** Platform names come with their logo; a tag can be just platform + logo.
- 10-30 SideShift job-link previews: rejected the initial title-card, pay-first kinetic and blue dither samples; asked to use the SideShift logo plane in the next concepts.
- 10-30 link previews, round 2: "I really like this liquid metal look" (beveled chrome plane banking on dark slate #14191F, hiring brand logo + "is hiring", big UGC Creator / $150) and "B and C are great" (a scrolling wall of creator videos; platform logos orbiting the plane). Next round fused them: chrome orbit, chrome feed wall, plane mirroring the videos.
- 10-02 "tgae should just say the platform and have the logo"
- 10-06 "I wish it showed logo for the store like shopify and then just had item name"
- 10-09 "remove the crown emoji and emphasize the ads more using meta, tiktok logos"
- 11-03 New contract draft card (term changes in the agreement sidebar): picked B, redline rows (label, old struck, new bold), over the shipped before → after pill rows and a copy of the terms card with changes in green (my pick): "B, but dont need the platform names, just logo". A platform change is logos only, added ringed green, removed faded and ringed red
- 10-27 guest redlining terms panel (TikTok / Instagram as plain black text pills): "Make the platforms use the logo etc."
- 10-28 same panel, restyled with the wizard's logo chips but still limited to the campaign's 2 platforms: "why are you only showing 2 platforms it should show all 6". Reusing a shipped picker means its options too: a platform picker lists every platform the wizard lists, with the current ones selected

**7. Premium, never generic or AI-looking.** Liquid metal and the blue gradient for hero moments;
no emoji, sparkle/AI icons, "run by" pills or invented stats.
- 11-09 campaign Overview, the Marketplace Listing rail card (blue gradient sheen, metal buttons): "I'm not a fasn of the lqiuid metal for thew marketplac elisting". Liquid metal is for hero moments, not a working card that sits beside plain data cards on a dashboard; offered flat blue, white card, and a white card with the creator's card on the creator feed surface.
- 11-05 Ads plan /pricing (built as a bare "Ads / $0 a month" title over a two-row fee table): "/pricing needs a huge UI
  redesign. It should look exciting not be some shityty texzt on the screen". A plan or offer page is a hero moment: big price,
  the platform logos, the featured card's dark face. Never ship a pricing surface as a heading and a table, and show directions first.
- 11-02 plan-start welcome: "I like B, but it looks like slop". Keep the selected guided direction; replace the standalone HTML's fabricated miniature screens, pastel card treatments, and repeated descriptions with the real product kit before the next review.
- 10-31 Meta copy suggestions: “they shouldnt say written by sidekick”. Use the shared Sidekick visual components without an authorship label; keep the generated copy and its actions first.
- 10-30 shared job previews: approved liquid-metal C with the SideShift plane; asked for more motion and a prominent hiring-brand identity.
- 10-20 "the run by sideshift pill looks AI generated" · "remove the stupid AI icons then use an actual case study"
- 10-20 "I dont like the arbitraty numbers though" · 09-29 "make it more flashy including the ads icon"

- 11-08 comment-to-DM brand card, a stack of labelled full-width fields: "The UI takes up so much space. Is there a way to compress it?", then on the compressed version (pairs side by side, replies as chips): "this UI is a little broing and also the tab sawicther is fucked". A shipped control (SegmentedControl) squeezed below its built height breaks; never resize a DS control to fit a label row. The DM-thread rebuild (editable chat bubbles, button text inline): "I dont like this either, design a couple of options and present them to me". Show directions before rebuilding a rejected settings card.
- 11-09 same card, three directions (A workflow-builder steps on a timeline, B collapsed summary rows (my pick, most compact), C fields beside a live DM preview): "I like A", with "reply under the comment would be the second step". An automation setting reads best as the workflow builder's steps (ToneGlyph + DsTimeline), not as the most compact list; list steps in the order he thinks of them (the public reply straight after the comment).

**8. Fewer controls.** Two direct buttons over a "more actions" menu; an x over a toggle list; a
secondary link over a second full button; a deep link over a "check" button.
- 10-21 "I dont like the more actions it can just be contrcat and analytics buttons"
- 09-27 "instead of toggles… can it just be a small x to remove a component"
- 10-01 "I like how it was where skip for now was a secondary option, not a whole button"
- 11-05 contract editor, one 72px row with Edit/Preview, 15 formatting controls, Insert, Sign, Templates, Upload, Save and ⋮ (formatting scrolled sideways at 1280px): "need to redesign the UI, maybe making the button options on the right or something. The top header bar is too full". Adding a button to a full toolbar row is the moment to re-split the row, not to shrink the button to an icon

**9. Prompt or queue, don't error.** If the user can fix it, open the fix.
- 09-30 "I wish it just opened a popup that prompted user to connect that specific account"
- 10-22 "it should just queue it instead of showing an error"

**10. Balanced layouts, every width.** No gaps, no stretched web layout, no half-empty pages;
platforms inline, not wrapped to two rows; on mobile the action stays in view.
- 09-30 "switiching location with budget would make the review screen feel more full and not leave a gap"
- 10-22 "all the ad platforms appear inline right now they fall into 2 rows"
- 10-27 Billing plan card at 390 px, four buttons wrapping as 1 + 2 + 1 (Cancel Plan alone, Change Plan alone on a third row): "This UI should be fixed". Check every button row at 390 before showing it; uneven wraps read as broken

**11. Setup lives in settings, not in the main flow.**
- 10-26 "I dont like having Business name and Logo in the build ad flow… in ad settings -> accounts"
- 11-07 campaign brief pages, three editor directions built for the create wizard's Brief step: "it doesnt need to be in the campaign creation, check the other chat thats redesinginng the campaigns tab". Rich content a brand keeps working on (a brief with videos, named briefs) belongs on the object's own page (the campaign page's Brief tab), not in the create flow. Before placing a new surface, check what sibling sessions are building for that page; the redesign session had already offered a Brief tab.

**12. Speed is design.** Slow loads and multi-step reveals get rejected even when the UI is right.
- 10-26 "looks good, just takes too long to load" · "comes back in 3 steps. I dont like that UX"

**13. Copy says what actually happens.** Name the thing as it is ("Book your onboarding call"),
not a hype promise or a state the user is not in. A spec's sales copy is not a fact.
- 10-26 "the youre in isnt true though, its just an onboarding to get them setup and answer questions"
- 10-27 open-joining brand popup ("Creators now join when you accept them", shown as a flow diagram, a before/after or a corner card): "It needs to communicate the fact that they can still keep their old flow but now they dont need to resend the campaign invite. Also ther UI needs to be improved". A change announcement names the one step the user stops doing, in their words (the campaign invite), and says the rest stays the same

- 11-08 creator release popup + first-application popup, built around a warning ("Signing doesn't mean you're in", locked New account / Warm-up tiles, "You're not in yet"): "I dont like the negative direction you took in this approach. It should explain the new flow but put it in a positive light and explain what makes it better". A change announcement sells the change: name what got better (no invite to wait for, account approved instantly), and put the rule creators keep breaking as the next step ("Start when you're in"), never as a lock or a "not yet" headline. Even when the ask came from a complaint about misuse, the user-facing copy stays positive.
  Round 3 (release popup offered as story / benefit rows / captions, all on the same Path picture as the first-application popup): "I dont like them having the same UI, I like the fatser way to join campaigns text although I still want a diff image for the UI". Two popups a creator sees in sequence must look different: each gets its own picture, even when they explain the same flow. "Matches the other popup" is not a reason to pick a layout. Kept: title "A faster way to join campaigns" + benefit rows.
  Round 4 (pictures: phone with "You're in" message / card that flips to "You're in" / check with platform tiles): picked the phone, "no need for a read me since that should be the popup". The concrete moment (the message a creator will get) beat the abstract ones. Put what matters on the popup itself; a Read more fold under it is redundant.
  11-08 "You're in" popup with the Path blocks picture and green New account / Warm-up tiles: "Im, not a fan of the image sop provide a couple of options, also I think the new account and warmup should be light blue". The Path picture worked as a progress diagram in the flow, not as the celebration moment. Unlocked creator tiles use the kit's light blue (#E3F5FF, #0A8FD6), not green; keep green for the single accepted check.
  Then picked A (campaign's own cover as a tilted card + green check) and: "the locks dont look unlocked". Lucide's LockOpen at 12-16px reads as shut. When a state change is the point (locked → unlocked), draw it so it reads at the shipped size, or show the change happening; check the glyph at its real size before showing it.
  Then: "just remove the locks form youre in". On a positive "you can start" moment, no lock badge at all; a lock belongs only on the locked state.
  First-application popup, built as "You've applied" + campaign terms: "the first apply was meant to just be that first screen when they open the first application after the new release, before signing … it should be the text we mention about new flow". When a screen's trigger is ambiguous ("first application"), pin down the moment (before/after signing) and its content before building pages around an assumption.
- 11-08 open joining emails ("Common questions" with "Can I turn this off?", "Will I get fewer applications?", "What if the brand does not reply?", "Something does not work?"): "Common questions is a bit negative… I just want to ensure that this is taken with a positive mindset", and lead with the positive stat (share of campaigns that post by day 14). Applies to emails too: headings and FAQ entries are statements of what got better ("Good to know", "You stay in control"), not worries phrased as questions; drop "not/never/no" headlines.
  Then, round 2 (positive copy; 3D path of raised blocks, application card or padlock; release popup ending on green New account / Warm-up tiles; first-application story / shelf / plan): "I like design of A for both. For 1 Id like the UI to be changed. Also I need to know what would be in the read more". Picked the 3D path with a pin, and story steps. The picture-over-tiles release popup was not the UI. When presenting a popup, list what Read more holds; don't leave it behind the fold.

**14. Give real options when it is new.** For a new screen, two or three different directions,
not a variant of the closest weak pattern.
- 10-23 "This is awful. Be more creatve. This is why I asked for you to provide options."
- 11-02 plan welcome: "This is awful too, designb a couple of options and presenmt too me" after the selected guided concept was rebuilt as three gray DS cards. Component reuse does not fix a weak composition. Compare new layouts when options are requested again; preserve the useful content, not the rejected card grid.
- 11-08 open joining email diagram (two columns of six vs three black/outlined boxes with arrows): "this visual is bad. It looks generated poorly and I understand the point but I dont think its presented well. Can you present a couple of options". Applies to email images and diagrams too, not only screens. Generic boxes-and-arrows reads as generated; use real product pieces (the Sign & apply button in the creator blue, platform logos, a big number) and show 2–3 directions.

- 11-03 connect step guide: three connect-sheet directions (a card anchored to Connect, steps in the row, a guide popup) for what he had described as a Wispr-style floating card: "This isnt at all what I was thinking, this is a connect but I was looking for a floating step bey step guide". The options must all be the thing he named (here: floating, free of the page). Three variants of a different thing are not options.

**15. Add to an existing control before adding a new row.** Extra things about the selected item
(other cuts, variants) belong in the control that already switches it, not in a new strip that
pushes the layout.
- 10-27 brand edits strip under the Video Reviews player: "I dont like the UI where edits are pushing the video review up. Maybe having them under versions would be more intuitive"

**16. A choice must show its effect.** A setting whose result never appears on screen reads as not
built, even when it works end to end. When a control changes what a user will get, the nearest
preview redraws to match.
- 10-29 Meta "Header identities" dropdown (Both / Creator only / Dynamic, live since August, but the
  phone preview showed the creator alone for all three): "I just want to implement it, I havent seen
  it in practiuce in the UI". Picked: the preview draws each header, Dynamic flips between its two
  versions, over option cards and over a new default

**17. A floating guide is small and movable, never a banner.** A card that rides over another app
is as small as its text allows (a short list like Wispr Flow's), and the user drags it out of the
way. Its copy inside our own screen is shown at that same small size, not stretched to full width.
- 11-03 iOS connect guide, a full-width dark strip (logo, step tiles, one big line, progress bar)
  shown inline at full width and floating at 450 pt on the iPad: "Its wayyy to big, it needs to be a
  small component that can be dragged around and positioned in the same way that whisper flow had"
- 11-03 same card, after it ticked steps and turned green on approval: "The video can stay constant though.
  No need for it to update". A floating guide is a fixed list of steps; state belongs on our own screen

**18. A control added inside a compact surface takes that surface's size, not the form's.** A popover,
menu or chip editor has its own scale (12–14px text, 24–32px controls). New fields inside it are one
short line at that scale, never the page form's labelled 40px field.
- 11-03 hashtag popover (calendar for posting days), Entry limit added as a WizardField label + two
  40px boxes (number, "per creator each month" select) under the calendar: "the UI is wayyyy too large".
  Rebuilt as one 32px line: "Max entries [5] [in total ▾]"
- 11-03 then: "when setting a hashtag just in the UI have the max # inline with the text as an optional
  setting not something to change later". An optional setting of a thing being added goes on the
  same line as the thing's input, set at add time, not in an editor opened afterwards. Built as a
  "Max #" box inside the hashtag input; the per month / per platform choices left the UI

**19. Before adding another action next to look-alike actions, merge them into one picker and one button.**
When a surface already has two or more buttons that do the same kind of thing (download, export, create),
do not add another one. Turn them into a list of choices (DS `ChoiceRow` radio rows, one short line each)
and one primary action whose label follows the choice.
- 11-05 Payouts → Generate Report: a scope toggle plus four outline download buttons, each with a hint line,
  after "Download daily cost by video" was added: "this UI is at the point where it needs to be reworked, too
  many similar buttons". Picked A: five report radio rows plus one "Download CSV/PDF" button, over B (a select)
  and C (menu rows that download on click)

**20. No metrics UI before there is anything to measure.** A page whose data needs a connection
shows only the connect step until it is connected: no zero charts, date ranges, filters or Build
buttons around it.
- 11-05 Ads page with no ad account (Performance chart, date range and Build Ads above the connect card): "why does the chart show if they havent connected an ad account yet? I thosuld only show once connected"

- 11-09 Ads Settings → Attribution (Northbeam card shipped as four stacked full-width rows: "NO" initials tile + Connected chip, a reporting toggle row with a sentence, "0 of 4 recent ads carry Northbeam's tag / New ads carry it", "1 ad Northbeam isn't reporting / Preview test ad"): "this UI is awful. Can you do a redesign". A connected tool is not a stack of settings rows: use the tool's real logo (never initials), show its state as numbers or chips, and say the choice (where sales come from) instead of a toggle sentence. Built it as one direction without asking; a new surface gets two or three.

## What he approved

- 11-09 Ads Settings → Attribution, round 2 (A three tiles answering "Sales in Ads come from": Ad platforms / Northbeam / Triple Whale with real logos, plus one status line under them; B one card with three numbers; C both tools side by side; my pick A): "I like A". A choice between sources reads best as a tile per source, the selected one outlined in blue, instead of a toggle on one tool; and the follow-up status (tag count, ads not reporting) fits on one line under the choice, not in rows of its own.

- 11-08 campaign Brief tab, after the round-3 block builder (palette rail, drag blocks onto the page): "Like this design is still bad it should encourage them to include it in the same way that we do for ads with the cool visual". A feature brands should adopt opens on a hero that sells it, the Ads first-ad screen pattern (liquid-metal centre, orbiting logos of what it holds, one line, check pills, blue CTA, quiet secondary link), not on an editor or an outline. Built as `BriefHero` on the shared `OrbitVisual`, then rejected: "this is exactly the same as ads, I wqant somethging different. Come up with a couple of designs". "In the same way as ads" means the same job (a hero that sells it, one CTA), not the same visual. Each feature's hero gets its own metaphor drawn from what that feature is (for the brief: the creator's phone reading it, the doc coming in, the brief's parts); never reuse another screen's signature visual. Round 2 (A creator's phone showing the brief, B Notion/Docs tiles into SideShift, C the brief's parts as fanned cards; my pick A): "I like the design of A, need to work on the UI a bit though". A product-in-a-phone hero beat a logo diagram and an abstract structure: show the thing the customer gets, as their audience sees it. Round 3, on the polished A: "I don tlike the notion + google docs tags. Can you build some iterations of those. Also ensure it has real videos". Floating label pills ("Notion page", "Google Doc") read as stickers, not product; and grey placeholder tiles in a showcase are a tell. A hero's media is the brand's own real content (their top posts, playable), with placeholders only when they have none. Round 4, on a campaign with only a text brief (hero above the Brief card, Examples card and rules rail): "theres no need to have brief and examples when we have the large UI above". When a hero sells the next step, it stands alone; don't repeat the old content beneath it. The old content opens through the hero's CTA. Round 5: offered three replacements for the pills (Notion page + Google Doc tucked behind the phone, a "Use your doc" button with logos, logo tiles docked on the phone); Liam asked "so whats the decision?" and I chose the pages behind the phone. When he asks for the decision, make it and ship it; don't ask again.

- 11-08 Brief tab, round 2 (A document + 316px rail with example videos and the campaign rules, B videos-first strip, C centred page; my pick A): "This is good, I just want it to feel full even when empty. Then have dsrag and drop components like header etc. Take inspo from slack block builder". A approved. An empty or one-line brief must still read as a full page (no lone card on a bare background), and the brief editor is a block builder: a palette of blocks (header, text, video…) dragged into the page and reordered by drag, after Slack's Block Kit Builder, not a document toolbar.

- 11-07 campaign brief pages: "A and A". Brand Brief tab: picked A, one card that shows the brief as creators read it, named briefs as a switcher inside the card, Edit turning the card into the editor in place with Save and Cancel where Edit was (my pick), over B (editor always on with a live creator view beside it) and C (one card per brief opening a full-screen editor). Creator view: picked A, every block in the brand's order with videos playing in place (my pick), over B (one section at a time from the headings) and C (videos first, text folded). Read-first beat always-editing again (contrast principle 16): a page read far more than it is edited opens on the reading view.

- 11-07 campaign page redesign (Details page "absolutely useless", Jobs tab to go): shown a board of real competitor screenshots (JoinBrands, Whop Content Rewards, Insense, Aspire, Billo, viral.app) and three directions. "I like C": four tabs Overview · Brief · Creators · Settings, Overview = the Analytics components scoped to the campaign plus the blue listing card as a recruiting rail (my pick), over A (analytics is the whole page, brief and listing behind header buttons) and B (six tabs). Real references before design worked; he asked for them up front.

- 11-07 campaign briefs: "A, B". Brand wizard: picked A, one 48px line per brief (name, posting-days chip, # and link icons, inline Max #, archive), added like a hashtag (name + Max # + Enter), over B (hashtag-style chips with settings in a popover) and C (read-only table, every edit in a DsModal). Creator videos found by hashtag: picked B, one strip above the Posts grid (thumbnail fan, "3 videos need a brief", Pick) that steps through a popup "1 of 3", over A ("Pick brief" pill on each faded tile) and C (filter pills led by "Needs brief · 3"). Both my picks: settings set inline at add time (principle 18), and a queue over hunting tile by tile (principle 9).

- 11-05 Ads connect screen, "No ad account yet?" path for brands with no ad account: "A". Picked A, a quiet text link under the Connect button that opens a DsModal of Connected Sources rows (logo tile, name, what the platform needs, Create ↗ that turns into Connect) (my pick), over B (the link swaps the screen's copy and button for the rows in place) and C (the rows always visible under the button, no link). Fifth time the shipped pattern beside the entry point won; the hero screen stays unchanged for brands that already have an account.

- 11-05 Ads plan on /pricing: "I like the band." Picked A, a dark band above the paid row (featured card's face; Ads + big $0 left,
  TikTok/Meta badges + one line middle, Start free right), over B (Ads as a fourth fanned card) and C (a two-path tab with a
  full Ads hero). The free offer on top as its own hero, paid plans untouched below.

- 11-05 agency and upgrade app welcomes: agency must center on managing client workspaces and agency work, not a brand, brief or single-client campaign. “Starter shouldnt be the big, it should be Agency”: Agency is the large plan identity; Starter/Growth/Scale stays a secondary included-client detail. Upgrade keeps the old compact receipt, using Nikolai’s header and content formatting; no two-sided plan sidebar. This replaces the earlier split-layout choice for upgrade. Agency welcome needs a useful set of next steps beyond adding/switching clients: team access and client results belong here too. Approved the final hosted preview with “looks good, merge” on 11-05.

- 11-05 brand creator invite page (/creator-invite, "join our creators"): "go with B", one narrow centered card (brand logo, "Join <brand>'s creators", website/social links as icon-only buttons, one button + Log in) over A (the campaign invite link's two-column frame, my pick) and C (brand photos as a hero strip, about text, bottom action bar). The shipped-pattern rule lost this time: for a one-step action the fewest words won (principle 1), even over sibling-frame consistency.

- 11-05 Import from Trybe connect step (Trybe → SideShift logo tiles with an arrow, a sentence, black "Connect Trybe" + "Upload a file instead"): "I dont want the upload a file option only the connect Trybe, but please redesign the screen, the UI should fit aroudn the other ocmponent we have on the site". Rebuilt as the Connected Sources IntegrationRow (gray logo tile, name, "Not Connected", blue Connect pill) used by Analytics and the store panel. A connect step for a new integration is that row, not an invented hero of logos.
  Then, seeing the row: "I like the import from Trybe to SideShift I think it should just be a more exciting design to encourage people to do so". Wrong lesson above: he liked the Trybe → SideShift logo pair; it was too plain, not invented. A migration we want brands to make is a hero moment (principle 7), not a settings row.
  Then, of three directions (A hero band + two checked rows, B the Ads connect gate layout with pills, C a gray program card crossing to a live one): "I like A, use just the paper airplane not the full favicon so it can be larger". Picked A (my pick). The SideShift mark inside a logo tile is the bare plane, never the dark app-icon tile, so it fills the tile like the partner's logo.
  Built at 36 px beside Trybe's 32 px: "make the plan[e] slightly smaller. Otherwised the UI looks good". Approved; the two marks in a pair are the same size (32 px in a 64 px tile).
- 11-04 Import from Trybe (connect Trybe, pick a program, open the wizard on Review): picked A, a DsModal like the template picker beside the entry button (programs as DS radio rows: name, terms on one line, avatar stack + count), over B (own page with step rail and a live campaign preview card, principle 16) and C (program tiles with the creator count as the big number inside the wizard's first step). Fourth time the shipped pattern next to the entry point won.
  11-09, seeing it live (each row: name, then the carried terms and "Not carried over: …" wrapping over 2-3 lines): "this is jumbled, can you just have the campaign names?" Rows now show only the program name plus the avatar + count. A choice list is for picking: the name identifies the item; detail the brand reviews after picking (here the wizard's Review step shows the pay) does not belong in each row.

- 11-03 iOS floating connect guide: "lets go with A". Picked the short dark list (Wispr Flow's layout: every step on its own row with an icon, current row bold, done rows ticked, last row "← Back to SideShift") over a one-line pill and a square badge.

- 11-02 plan-start welcome, final logo pass: "Looks good". Approved A with the dark plan sidebar, campaign name, brief, invitation count, brand logo and action-specific icons; requested actual plan-start wiring and a Starter / Growth / Scale comparison.

- 11-02 plan welcome refinement: "This looks better tho" after adding the campaign name, brief and invite count with action-specific icons. Asked for the brand logo beside the campaign identity; keep the selected split layout.

- 11-02 plan welcome: "A is great" (dark plan sidebar beside a plain action list). Keep that composition. "It could use details from the campaign and the icons could be more specific to the actions": make the campaign name, brief and invite count the content, with search, editing and video-review icons.

- 09-29 ads dashboard component: "I really like this design, looks great"
- 09-28 Getting started card: "good as is"
- 10-23 platform connect "orbit" direction, with Snapchat as yellow box + white ghost
- 10-04 demo account: "Looks insanely good"
- 10-26 open joining: picked the Launchpoint-style sign step (contract page thumbnail + "View contract" beside a Draw/Type signature) over a no-preview and a sign-on-the-page variant; for post-accept setup picked a "You're in" logo-tile popup + a logo strip on the campaign card over a card of the shared OAuth rows (which carried a yellow guidance box)
- 10-27 creator profile accounts: picked plain stacked rows (closest to shipped connect rows) over a logo grid and a logo strip with big counts; then "this isnt the entire profile": show new sections inside the real page, not a standalone preview. Best posts with 3 add paths (upload, paste, campaign posts): one add sheet over inline
- 11-02 influencer packages on the creator portfolio: "lets go with A" — plain rows (name + one-line summary left, exact price right, row opens a one-package popup, + in the section header) over 2-up rate tiles with a big compact price and over a brand-view accordion with a pencil per row. Second time the plain stacked row beat big-number tiles on the creator profile; the creator editing their own price wants the exact figure, not "$1.2K"
- 10-26 affiliate "On hold" line, web + iOS: lock icon, "On hold" and the amount; when it clears only on hover. Cut from a sentence-long label before he saw it: "merge"
- 10-27 brand "Add edits" dialog: picked the ad builder's existing upload zone (dashed box, Upload button, file rows with %) over thumbnail tiles (my pick) and no-dialog upload into the version menu. Reuse of a shipped pattern beat a new visual.
- 10-27 Ad Settings with 8 sections (pill row overflowing the modal): his idea, "make ad settings its own tab"; picked a Settings tab on the Ads page with the grouped sidebar from account Settings over a tile grid with big numbers and over keeping the modal with 4 grouped pills. Again the shipped pattern won.
  Then, seeing it built: "having 2 navbars is bad UI" (page tab bar + section sidebar on one screen). Never stack a second nav under/beside a page's tab bar; one nav visible at a time.
  Then the fix I recommended (Settings tab opens on a phone-style list of sections, drill in): "this UI is horrible, come up with somthing elegant and easy to navigate". A phone list stretched onto desktop (half the page empty, a click per section) is not elegant; desktop settings need every section one click away and the width used.
- 10-27 new-creator onboarding explainer: rejected tap-to-play mini games ("I dont like this actual interactive, but something visual showing real creators and videos"); liked a fan of real videos with one big real number, but "the UI should be diff for each of the 3 steps"; "Dont use a real example for step 1" (a made-up fresh account, not a real creator, for the account you are about to make); the warm-up should show the actual scrolling, liking and saving, and "should be faster" (1.4s a video); disliked "Or make ads" as a title and picked "your video becomes a brand's ad + Approved +$40" over a two-column comparison and a list of live briefs. Real videos and real pay sell; text explaining them does not
- 10-27 open-joining brand popup: picked A (three tiles Review → Accept → struck Invite on the blue hero stage) over the real applicant card and a spotlight on the Applicants page, then "it needs to be more clear as well as a readmore to explain the reasoning behind it and show they can still use their old flow if they want". A change announcement: the main view says only what changed; the why and the way to keep working as before sit behind Read more
  Round 3 (title "No invite needed for applicants", Read more in a plain card): "This looks good, we'll also need to make the same update on the creator side". An announcement to one side of the marketplace gets its counterpart on the other side
- 10-27 payout breakdown, videos behind the Ad Performance amount: picked "thumbnails" (an overlapping thumbnail stack + "2 videos" that expands to per-video lines on click) over an always-open list of video lines with amounts (my pick). Breakdown card stays short; detail one click away (principle 5)
  Then on "Get paid either way" ("too text heavy… could showcase the vids more") I built three video-led directions (video wall, one cycling video, posting | ads split): "These all suck the old card fan was good I just didnt like the fact you have an actual creator on there". When he asks for a tweak to something he already liked, change only what he named (here: remove the named creator) before trying new directions
- 10-27 creator connect row (campaign invites, handle modals, audience requests): "go with A", the approved profile-accounts row used everywhere (logo or photo, @handle + verified + followers, Connect pill, + / x icons, account chips instead of a select, one-line hint instead of the amber guidance box) over a platform-coloured sign-in button and dashed account tiles with a big follower number. Third time on 10-27 the shipped pattern beat a new visual
- 10-27 profile accounts, the "Brands that can see your YouTube stats" box (title + brand line + Remove) nested under a connected row: "this UI is awful, can you remove that it doesnt need to show". Never nest a secondary card inside a list row; a row is one line of the account, and anything else stays off it or lives one tap away
- 10-27 creator "Connect your accounts" popup (a struck typed handle "Waiting" → signed-in TikTok row "Added", three Read more lines): "I dont like this design." Next: the You're in popup's logo tiles (shipped pattern) instead of an invented before/after
  Then on the logo-tile version: "the read more should include better insights, bot detection, include the fact that it doesnt mess up their account alg since some creators are scraed of that". A Read more answers the user's real fears and gains (reach, proof), not how the feature works
- 11-02 Comment-to-DM campaign settings ("very overwheming and unusable": ~14 controls + 6 help lines at once): picked A, four fields (platform logo chips, keyword chips, reply, link + "Add UTM") beside a live DM preview, rest in More options, over a rules list (B) and a step flow (C). Seeing it built: "this good, just remove the preview though". The four-field card + More options was the win; the DM preview beside it was not wanted (contrast principle 16)
- 10-30 AppLovin generated end card (the full-screen image after an in-game ad video): picked A, the cover frame blurred behind logo + headline + brand-colour button, over B (sharp creator frame on top, brand panel below; my pick, "the creator face sells") and C (brand-colour poster with a tilted video still). "A, go ahead an build this out then we can iterate". For a generated ad asset he chose the standard, clean in-app pattern over the creator-forward one; the connect modal, builder fields and phone preview built from shipped parts passed without comment

- 11-05 ad platform logos: dark mode must keep the full-color Snapchat and LinkedIn badge artwork from light mode, including the yellow/blue tile and white glyph; tinting bare mono marks did not meet the request.
- 11-06 Trybe import, "Your Trybe creators" invite picker (one flat list of imported creators): "it should be clear that you can match the creators you already have and then invite the rest". Built as two labelled groups in the same picker, "Already on SideShift · N" then "Not on SideShift yet · N" (email field per row), and a caption that counts both ("2 already on SideShift, 3 to invite by email."). A list that mixes two reach routes must show which route each creator takes
- 11-06 contract editor right-column actions card ("the 3 lower actions seem unaligned", screenshot): I fixed a 4px measurement (blank icon slot 16px vs 20px icons) → "you didnt modify the UI". What he saw was icon-less rows reading as indented. For visual feedback, fix what the screenshot shows at a glance (here: give every row an icon) and compare before/after shots; a sub-5px change that leaves the look the same is not a fix
- 11-09 brief docs as components: each Notion/Google Doc in a brief becomes its own titled card (icon tile + title + site, opens full screen in the app), the same on web, iOS and Android: "yes thats great, but let them customize the icon too". For the icon he picked a fixed drawn icon set (12, in our tile, title picks the default) over emoji or uploads.
- 11-09 first-apply 3-step intro (Claude Design, three directions: A a real app piece per step — signed contract + Sign & apply pill, Glow's "You're in" chat bubble + Accepted chip, light-blue New account / Warm-up tiles; B one campaign card moving forward with an Apply · Accepted · Start track; C one-sheet vertical timeline; my pick A): "Go with A, but create more 3D like designs". A product-piece-per-step won again; flat illustrations of those pieces read as too plain — he wants depth (tilt, thickness, cast shadows), as on the earlier 3D release-popup phone.
  Round 2 (A1 floating objects / A2 one light-blue slab per step / A3 a turning 3D iPhone; my pick A1): "I like A1 for sign, A2, for B and neither for C". He mixes per step: floating tilted contract for Sign, phone on the slab for Accepted. Square blocks/tiles for "New account + Warm-up" were rejected in all three 3D treatments (and as flat tiles before): show the new account and the warm-up themselves, not two labelled boxes.
  Round 3 (step 3 options C1 new empty profile on the phone / C2 two thick cards: Make your account + warm-up days / C3 a liked-and-saved video; my pick C1): "I like C, but ensure that warm up is 6 days and then make your account encompasses all the platforms". He picked the card that names both actions over the more illustrative phone; copy in a picture must match the real product (warm-up = 6 days, every campaign platform, not only TikTok/Instagram).
  Round 4 (final: two fanned cards tilted opposite ways, 7 coins in a 4+3 cluster crossing the card edge, Day 1–6 tiles ~30px with "Day 4" clipped to "Dav 4"): "this UI isnt very clean. Can you redesign so the components are larger". 3D must stay calm: one gentle tilt for the whole group, components sized for the picture area (coins 40px+, labels 13px+), nothing clipped or crossing a card edge. Check every label renders whole before showing.
  Round 5 (Final A: two stacked cards, 7 coins + title + sub-line, 6 day tiles each with check + "Day N" = ~30 elements in one picture; Final B one card with a 6-dot track; my pick B): "I like A, theres just too much on the screeen and I wish it was simpler". Count the things in a picture before showing it; a step picture carries one idea at a glance, and a title that already says the number ("6 days") makes per-item labels redundant.
  Round 6 (Simple 1 / Simple 2, both showing all seven platform coins): "I think showing all platforms is the issue. Show only iunsta + tiktok and then redesign the warmup to udnerstand more". He reversed his own "encompasses all the platforms" once he saw seven coins crowd the card: a picture shows the two most common cases, not the full list. A warm-up shown as checks alone doesn't say what to do; show the action (scroll, like, save).
