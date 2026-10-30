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

**3. Match the existing design system and the closest sibling surface.** Analytics is the
reference for metrics, charts, stat icons (liquid-metal grey) and platform pills. A Figma, or
the other platform's app (iOS to web), is for content and structure, not a new visual language.
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

**5. Big number first, short cards, secondary data hidden.** He prefers one large number to a
pill, a short card to a tall one, and "show more" to everything at once.
- 10-30 Meta copy suggestions: "only needs to generate a couple", clarified as "actually generate new copy based on their existing ads". Generate exactly two primary texts and two headlines; retain both options after selection, with no Load more.
- 10-15 "I dontl ike the pill, I like the big number the A had"
- 10-21 "the profile card is a little bit too long… highlighted more of the neccessary content"
- 09-30 "simplified to show most important values and then have a dropwdown to show more"
- 09-30 small grey metric text: "I wish this could just be hidden for the most part"
- 10-26 creator referral page: "Gain inspiration from robinhood who puts a big number and encourages people to get a ton of referrals in order to meet that" (one aspirational number, then a milestone ladder)
- 10-26 $74.75 a month per brand: "can you round the numbers up. starter should be 75", then "make those the actual values" (round numbers, and the payout changed to match rather than the page rounding)

**6. Logos beat labels.** Platform names come with their logo; a tag can be just platform + logo.
- 10-30 SideShift job-link previews: rejected the initial title-card, pay-first kinetic and blue dither samples; asked to use the SideShift logo plane in the next concepts.
- 10-02 "tgae should just say the platform and have the logo"
- 10-06 "I wish it showed logo for the store like shopify and then just had item name"
- 10-09 "remove the crown emoji and emphasize the ads more using meta, tiktok logos"
- 10-27 guest redlining terms panel (TikTok / Instagram as plain black text pills): "Make the platforms use the logo etc."
- 10-30 link previews, round 2: "I really like this liquid metal look" (beveled chrome plane banking on dark slate #14191F, hiring brand logo + "is hiring", big UGC Creator / $150) and "B and C are great" (a scrolling wall of creator videos; platform logos orbiting the plane). Next round fused them: chrome orbit, chrome feed wall, plane mirroring the videos.
- 10-28 same panel, restyled with the wizard's logo chips but still limited to the campaign's 2 platforms: "why are you only showing 2 platforms it should show all 6". Reusing a shipped picker means its options too: a platform picker lists every platform the wizard lists, with the current ones selected

**7. Premium, never generic or AI-looking.** Liquid metal and the blue gradient for hero moments;
no emoji, sparkle/AI icons, "run by" pills or invented stats.
- 10-30 shared job previews: approved liquid-metal C with the SideShift plane; asked for more motion and a prominent hiring-brand identity.
- 10-20 "the run by sideshift pill looks AI generated" · "remove the stupid AI icons then use an actual case study"
- 10-20 "I dont like the arbitraty numbers though" · 09-29 "make it more flashy including the ads icon"

**8. Fewer controls.** Two direct buttons over a "more actions" menu; an x over a toggle list; a
secondary link over a second full button; a deep link over a "check" button.
- 10-21 "I dont like the more actions it can just be contrcat and analytics buttons"
- 09-27 "instead of toggles… can it just be a small x to remove a component"
- 10-01 "I like how it was where skip for now was a secondary option, not a whole button"

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

**12. Speed is design.** Slow loads and multi-step reveals get rejected even when the UI is right.
- 10-26 "looks good, just takes too long to load" · "comes back in 3 steps. I dont like that UX"

**13. Copy says what actually happens.** Name the thing as it is ("Book your onboarding call"),
not a hype promise or a state the user is not in. A spec's sales copy is not a fact.
- 10-26 "the youre in isnt true though, its just an onboarding to get them setup and answer questions"
- 10-27 open-joining brand popup ("Creators now join when you accept them", shown as a flow diagram, a before/after or a corner card): "It needs to communicate the fact that they can still keep their old flow but now they dont need to resend the campaign invite. Also ther UI needs to be improved". A change announcement names the one step the user stops doing, in their words (the campaign invite), and says the rest stays the same

**14. Give real options when it is new.** For a new screen, two or three different directions,
not a variant of the closest weak pattern.
- 10-23 "This is awful. Be more creatve. This is why I asked for you to provide options."

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

## What he approved

- 09-29 ads dashboard component: "I really like this design, looks great"
- 09-28 Getting started card: "good as is"
- 10-23 platform connect "orbit" direction, with Snapchat as yellow box + white ghost
- 10-04 demo account: "Looks insanely good"
- 10-26 open joining: picked the Launchpoint-style sign step (contract page thumbnail + "View contract" beside a Draw/Type signature) over a no-preview and a sign-on-the-page variant; for post-accept setup picked a "You're in" logo-tile popup + a logo strip on the campaign card over a card of the shared OAuth rows (which carried a yellow guidance box)
- 10-27 creator profile accounts: picked plain stacked rows (closest to shipped connect rows) over a logo grid and a logo strip with big counts; then "this isnt the entire profile": show new sections inside the real page, not a standalone preview. Best posts with 3 add paths (upload, paste, campaign posts): one add sheet over inline
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
