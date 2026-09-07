Read findings.md (automated accessibility violations from axe-core, grouped
by rule, with the affected pages and how often each occurs) and lang.txt (the
site's language). Write fixlist.md in that language:

- first line: "# " followed by a title naming the site,
- one short paragraph with the overall picture (how many rules, how many
  pages, the two most impactful problems),
- then a numbered list, most impactful first: for each rule the name, the
  pages or elements where it occurs, and how to fix it in one to three
  concrete sentences (which HTML or CSS to change),
- last a line "## Not covered" noting that automated checks find roughly a
  third of accessibility problems and what a manual check should look at
  (keyboard, screen reader, contrast in images).

If findings.md lists no violations, say so in one paragraph and still add
the "## Not covered" section. Use only what findings.md contains.
