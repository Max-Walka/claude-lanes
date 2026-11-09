Updated: 15 Jan 10:40
Now: card error messages on the payment step (#215), then the confirmation page
Branch: feat/checkout-card-errors
Open PRs: #212 (ready for Sam), #215 (CI running)
Files claimed: src/app/nav.ts (one line, the checkout entry)
Blocked on: none
Needs from other lanes: none
Handoff: #215 maps the API's decline codes to the copy in docs/checkout-copy.md.
  Two codes (expired_card, insufficient_funds) still use placeholder text.
  After #212 merges: rebase #215 and drop the temporary feature flag.
