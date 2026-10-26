# Static site (serverless)

`html@5_serverless/` is the designer and guests pages as a static site for any static host. Everything stays in the
browser; nothing is contacted unless the host enters an RSVP server address under **RSVP server** and publishes the
invitation (this app's backend, see `BACKEND_NOTICE.md`, or any compatible server). Then exported invitations post
replies there (with the offline reply as a fallback) and the guests page can **Sync replies** with the owner token.
