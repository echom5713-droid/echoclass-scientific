# Display language and canonical evidence

Beta.23 extends the English-primary presentation through scientific analysis, report explanations, CSV imports/exports and record/batch attachments. Beta.24 adds the public `/walkthrough` evidence trail, with native disclosure controls and unchanged fixture IDs, hashes and commands in both languages. Each HTML view supports `en` and `zh`; the existing language cookie retains the choice. Project and account pages already use the same preference. The older classroom views remain Chinese.

## Navigation and transport

Language links preserve the selected class, scientific report or attachment target. The shared link builder admits only explicit internal page paths and their documented target parameters. Unknown, duplicated or invalid locale/target parameters fall back to the public page in link construction and are rejected by operational routes. The locale parameter belongs to HTML views; existing strict API query and body contracts do not gain a locale field.

Views set their document language and `Content-Language`. The shared catalog contains fixed interface copy, not a record translation service. Its browser helper is served as a same-origin, uncached JavaScript asset before the five clients. The clients translate their own labels, states, confirmations and known validation messages explicitly. Record names, notes, filenames, receipt JSON, scientific input, method identifiers and original source excerpts are rendered as data using `textContent`.

Unknown server messages retain the original detail and receive an English error heading/code. This preserves diagnostics without pretending that arbitrary backend or user text has a verified translation.

## Explanation and hash boundary

The released `echoclass.grounded-cards.v1` evidence builder is unchanged. English reading aids are produced from the same cited structured fields and fixed method explanations. Supported card identities, method identities and field pointers are checked; unknown versions/cards or missing cited fields fail closed. The reading layer does not calculate statistics or use a language model.

An English page explicitly explains that hashes cover the canonical evidence, original source values and original explanation, rather than the English reading aid. Every card retains its original citation IDs and offers the canonical explanation and source value for inspection. Chinese presentation renders the existing canonical explanation directly. Optional model reordering still receives only the existing fixed topic/card titles and cannot supply claims or translations.

Retrieval retains its original corpus, exact excerpts and content hashes. Fixed answer/status/limitation messages have English display copy, with the canonical retrieval answer inspectable separately. Titles and excerpts remain in their original language. This change does not improve lexical retrieval coverage or evaluate a model.

## Retry identity

Display language is absent from every scientific, CSV and attachment retry key and command. Those keys continue to bind the account and operation target, plus the existing file/schema/hash facts where applicable. Reloading a locale link recovers the original identifier. An interrupted response followed by a language switch must read the original saved operation; only the existing explicit new-operation confirmation replaces its identifier.

## Verification

`tests/operation-language.test.ts` checks fixed-copy coverage and interpolation slots, static page/control parity, internal target-preserving links, every report topic against a real Python result on the labeled synthetic fixture, unchanged evidence hashes/citations, unavailable-result handling and browser/server reading parity.

The five existing browser-client regression suites load the same helper and retain their Chinese safety/retry cases. Additional English-to-Chinese reload cases verify identical scientific requests, CSV batches and upload receipts. English report/retrieval cases retain canonical text, original values and hashes, including markup-shaped untrusted content. The real HTTP/Python workflow checks both languages, cookie persistence, invalid parameters and unchanged API query rejection.

All examples used for tests and browser review are synthetic. These checks establish implementation behavior; they do not constitute independent statistical, security or accessibility acceptance.
