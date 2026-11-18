---
title: Content pipeline
columns:
  - slug: ideas
    label: Ideas
  - todo
  - slug: progress
    label: Writing
  - slug: qa
    label: QA
  - slug: seo
    label: SEO
  - slug: review
    label: Review
    review: true
  - slug: done
    label: Done
    done: true
agent: nora
---

Texts for netnode.ch, written by Nora (writer), checked by Rita (reviewer) and optimised for findability by Sven (SEO) before a human sees them.

- **Ideas**: humans collect tasks here and write in task.md what done looks like.
- **Todo**: ready to be written. A task entering Todo goes to Nora, who is woken.
- **Writing**: Nora writes the text as a file into the task folder and logs her steps.
- **QA**: Rita reviews facts and tone (review.md in the folder) and either sends the task back to Writing with findings or hands it to SEO.
- **SEO**: Sven checks findability for Google and the answer engines and writes seo.md: the CMS field values, the on-page findings and the GEO findings. Everything that changes the text goes back to Writing and to Nora; only when the text stands does the task go to Review.
- **Review**: a human reads text, review and seo.md and moves the task to Done, or back to Todo with a note in the log.

## House rules on this board

These come out of task 4 (BehiG post: five rounds, three drafts, three returns from a human). Each one cost a round. Read them before you start.

**One round each.** Rita and Sven hand a task back at most once. On the second pass they approve and leave what is left as nits in their file — and every nit says who closes it and at which step.

**The newest human instruction wins.** Feedback a human wrote into the log is younger than the done-when list in task.md and overrides it where the two collide. Say in the log which item you set aside and why; never quietly serve both.

**A task a human sends back from Review re-enters at Writing** and runs the whole chain again: Nora, Rita, Sven. Nobody skips a station because the text was approved once.

**Never edit an approved file.** A new version is a new file beside the old one (`draft-v2.md`, `draft-v3.md`), and the review that approved the old one stays where it is (`review-v2.md`, `review-v3.md`). If a finding is wrong in an already approved file too, correct it there as well, say so in the log, and get the approval renewed: a dated addendum above the old findings table, which stays as the record.

**The final draft is a CMS package, not prose.** One section per NodeHive field with counted values, the body without an H1 line, and at the end the list of what the editorial team cannot solve inside the text — the date to refresh on publication day, a backlink from an existing node, a workflow that has to run. That list is the checklist for the CMS step.

**netnode.ch has no meta-title field.** The node title is the `<title>` *and* the H1; the frontend appends ` | NETNODE AG` (13 characters), so the title has 47 characters of budget. `field_teaser_text` is the meta description and at the same time the list teaser and the RSS text, `field_article_leadtext` the visible lead above the image, `field_markdown` the body, `field_article_links` the sidebar; og:image is an automatic screenshot for articles. Every field start has to carry on its own: an "allerdings" that reaches back into another field breaks the moment somebody edits that field or the layout puts an image between them.

**Count what you claim.** Characters, words, anchors, dashes, URLs, occurrences. A number in a log line or a review is an instruction to somebody else: whoever writes "at three places" has counted three.

**Check, do not adopt.** Nora verifies Rita's and Sven's citations instead of taking them over; Rita re-reads a source herself when a finding replaces one. Twice on task 4 the writer corrected the reviewer, and that is the behaviour we want here. Fix texts in a review are proposals, not prescriptions — a better solution with a reason in the log beats the proposal.

**A conflict between QA and SEO is not a defect.** Where reader and search pull apart — length, on task 4 — nobody resolves it alone: both reasons go into the log, the decision goes to the humans.

**Facts before text.** Dates, deadlines and legal references never come from vendor or law-firm blogs, only from the primary source, and whoever writes them names it. If the commissioned hook does not survive the check, write the draft on the provable counter-hook and put the angle decision to a human with options and a recommendation — never hand back empty.

**Nothing is published from this board.** Only a human moves a task to Done; putting the text into NodeHive is Web's job and a task of its own.
