---
name: server-report
description: Produce a numbered status report of all servers in the server-list bundle
---

# Server report

When invoked:

1. Read the `server-list` knowledge bundle.
2. Output a numbered list of all servers (keep the existing numbering).
3. For each server print name, host, and last-known status on one line.
4. End with a one-line summary (total count, how many with open issues).
