---
name: shalomify
description: Rewrite a response in ASD-STE100 (Simplified Technical English) following Zinsser's four principles — simplicity, brevity, clarity, humanity. Use this whenever the user types /shalomify or "shalomify", and also whenever they ask for prose to be made plainer, shorter, or clearer: "say that again in plain English", "that was too wordy", "cut the fluff", "rewrite that simpler", "STE that", "simplified technical english", "too much jargon", "tighten this up". Applies to PROSE — an explanation, a message, a doc, a PR description, a comment. Not code: for making code simpler, use /simplify instead. With no target named, rewrite the immediately preceding assistant response.
---

# Shalomify

Rewrite prose so a tired reader understands it on the first pass.

Two sources feed this. **ASD-STE100** (Simplified Technical English) is the controlled
language the aerospace industry writes maintenance manuals in — it governs the mechanics
of a sentence. **Zinsser's four principles**, from *On Writing Well*, govern what to cut
and how the result sounds. STE tells you how long a sentence may be; Zinsser tells you
which words in it are dead.

The default target is the assistant response immediately before this one. If the user
pastes text, points at a file, or says "this paragraph", rewrite that instead.

## Zinsser's four principles

**Simplicity.** "Clutter is the disease of American writing." Strip each sentence to its
cleanest components. Simple is not simplistic — it is the residue of having actually
thought the idea through. Muddy writing is almost always muddy thinking, so when a
sentence resists simplification, suspect the idea, not the words.

**Brevity.** Most first drafts survive losing half their words. Cut every word doing no
work. The usual suspects: qualifiers that dilute ("very", "quite", "rather", "sort of",
"basically", "actually", "pretty much", "a bit"); adverbs already implied by the verb;
adjectives stating the obvious; and prepositional padding — *at this point in time* → now,
*in the event that* → if, *prior to* → before, *in order to* → to, *with the exception of*
→ except.

**Clarity.** If the reader has to reread a sentence, the writer failed — never the reader.
Say what happened, then why. Put the subject next to its verb. Ambiguity is a defect, not
a stylistic choice.

**Humanity.** Write as one person talking to another. Say "I" when you did something and
"you" when they need to act. Zinsser's point is that the writer is the product — a reader
follows a person, not a procedure. In practice this means owning the work in the first
person, admitting what you do not know, and refusing to hide inside the passive voice or a
fog of institutional nouns.

STE and humanity pull against each other — STE was designed to delete the author so that a
mechanic in Jakarta reads the same meaning as one in Toulouse. Resolve it this way: **STE
governs the mechanics, Zinsser governs the voice.** Short active sentences with one idea
each are exactly what a person talking plainly produces anyway. Keep the first person and
the honest hedge; drop the performance.

## ASD-STE100 writing rules

**Words.** Prefer the shortest common word that carries one unambiguous meaning. The
published spec ships an approved dictionary of roughly 900 words, each locked to a single
meaning and a single part of speech; it is not bundled here, so apply its principle rather
than its list. Representative swaps: *utilize* → use, *commence/initiate* → start,
*terminate* → stop, *accomplish/perform* → do, *obtain* → get, *sufficient* → enough,
*additional* → more, *attempt* → try, *indicate* → show, *assist* → help, *in the vicinity
of* → near.

**One word, one meaning, one job.** Choose a term for a thing and never vary it. Elegant
variation — calling it a "job" here and a "posting" there — is the single fastest way to
make a reader think two things exist. Do not use the same word as both noun and verb in
the same passage.

**Noun clusters: three maximum.** "Subscription invoice settlement event handler" forces
the reader to guess which noun modifies which. Break it with prepositions or hyphens: "the
handler for settled subscription invoices."

**Active voice.** Passive hides who acted, which is usually the fact that matters. "The
count was moved into the query" leaves open whether you did it or it was already so.

**Simple tenses.** Present, simple past, simple future. Avoid perfect and progressive
forms, and avoid `-ing` words unless they belong to a name ("tracking package") or are
doing real work as a noun.

**Sentence length.** Instructions: 20 words maximum. Descriptions: 25. One instruction per
sentence — a step containing two actions gets performed halfway.

**Paragraphs.** One topic each, six sentences maximum. Lead with the topic sentence. Turn
any procedure with more than about three steps into a numbered list; the numbers do work
that commas cannot.

**Articles stay.** "Open the file", not "open file". Headline compression reads as noise.

## What survives untouched

Cut words ruthlessly. Cut facts never.

Code blocks, commands, file paths, identifiers, table and column names, error strings, and
numbers pass through verbatim — STE exempts these as Technical Names, and a "simplified"
identifier is a broken one.

Treat these as facts, not clutter, and carry every one into the rewrite:

- **Verification status.** "I could not run this" must survive. Brevity pressure loves to
  compress a hedged claim into a confident one, which converts honest work into a false
  report. If the original did not claim proof, the rewrite must not either.
- **Genuine uncertainty.** A guess stays labelled a guess. Delete "I think" when it is a
  verbal tic; keep it when it marks real doubt.
- **Caveats, exceptions, and conditions.** "Except on agency subaccounts" is the whole
  point of the sentence.
- **Every distinct claim.** Three reasons in, three reasons out.

## How to do it

1. Read the target and list its load-bearing content — each claim, number, caveat, and
   statement of what was and was not verified. This list is the contract the rewrite owes.
2. Rewrite from that list rather than editing the original in place. Editing in place
   preserves the original's bad structure; rebuilding forces the ideas into short active
   sentences.
3. Cut per Zinsser. Read each remaining word and ask what it does.
4. Check the rewrite against the list from step 1. Anything missing goes back in.
5. Sweep the mechanics: any sentence over 20/25 words, any passive voice, any stray `-ing`,
   any noun cluster past three, any concept named two different ways.

Output the rewrite alone. No preamble, no "here is the simplified version", no
side-by-side diff — the request was for clear prose, so anything wrapped around it is the
clutter this skill exists to remove. Add one line at the end only if some idea genuinely
resisted simplification and the reader needs to know why.

## Examples

**Clutter and a buried caveat**

Before: "I took a look at the payouts page and it seems like the reason it's being slow is
basically that we're currently fetching every single post in order to compute the total,
which is pretty expensive. I've gone ahead and moved that count into the query itself,
which should hopefully make things quite a bit faster, though I wasn't able to actually
verify this against production data."

After: "The payouts page was slow because it fetched every post to compute a total. I moved
the count into the query. I have not tested this against production data."

*61 words to 32. The caveat gets shorter and louder.*

**Noun cluster, passive voice, gerund**

Before: "The subscription invoice settlement event handler configuration was updated so
that Purchase events are only being sent when marketing consent has been given by the
user."

After: "I updated the handler for settled subscription invoices. It now sends a Purchase
event only if the user gave marketing consent."

*A six-noun cluster becomes a phrase, and you can see who acted.*

**Hedging as clutter, uncertainty as fact**

Before: "It is worth noting that there is a possibility that the root cause here may in
fact be related to the caching layer, although I must confess that I am not entirely
certain about this, as I was unable to reproduce the issue locally."

After: "The cache layer may be the root cause. I am not sure — I could not reproduce the
problem locally."

Wrong: "The cache layer is the root cause."

*The wrong version is shorter and is a lie. Brevity that upgrades a maybe into a fact has
failed at clarity, which is the principle that outranks it.*
