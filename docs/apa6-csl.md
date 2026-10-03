# APA 6 CSL attribution

`lib/cslApa6.json` packages the unmodified XML template from the Citation Style Language styles repository, fetched on 2026-10-03:
https://github.com/citation-style-language/styles/blob/master/apa-6th-edition.csl

The template is titled American Psychological Association 6th edition. Its authors/contributors and original rights notice remain inside the XML. It is licensed under Creative Commons Attribution-ShareAlike 3.0:
https://creativecommons.org/licenses/by-sa/3.0/

Only the JSON transport wrapper is added. This template has its own license; it is not re-licensed as application code. APA 6 is an explicit `apa6` choice and does not replace existing `apa` (APA 7) preferences. Formatting runs locally through the existing CSL processor without a new API or provider. CSL formats supplied metadata; it neither discovers books nor proves claim support. Printed-page locators still require evidence from the source.
