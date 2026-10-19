# October 2026 public capture compatibility hotfix

This maintenance branch starts from `ab6cc6b181c62700b75d2ef34f47898145ba062a`,
the engine bundled in both public Guild Butler Capture 0.8.8 installers.
It restores existing loot/activity routes without taking later trade, journal,
private combat, history or UI work into the public hotfix.

## Cause and evidence

The current event enum removes `DebugAggroInfo` after `NewMob` (123).
The old profile route 143 now receives history arrays, causing `invalid guildName`;
real profiles arrive at 142. Pickups on 278 are silently unhandled by the old 279 route.
Anonymized October 15 decoded payloads reproduce both problems through the dispatcher.
Might/Favor 496 is corroborated by the same recording. The other changed event IDs
come from the primary enum, using established payload shapes; fresh live chest/fishing
verification remains outstanding.

Primary reference: [Statistics Analysis Tool event enum](https://raw.githubusercontent.com/Triky313/AlbionOnline-StatisticsAnalysis/main/src/StatisticsAnalysisTool/Network/EventCodes.cs),
retrieved October 19, SHA-256 `c25dcc523fcdbb8970c1f89c2439d125b896e29e14d3ffc2af2d8abc2aec14ed`.
The [0.8.8 build](https://github.com/designsvet/guild-butler-capture/actions/runs/36676299693)
records the engine commit above in both platform checkout logs.

| Event | Old | Current |
| --- | ---: | ---: |
| CharacterStats | 143 | 142 |
| OtherGrabbedLoot | 279 | 278 |
| Party loot setting | 237 | 236 |
| Party assignment / removals | 302 / 303 / 304 | 301 / 302 / 303 |
| New / update loot chest | 393 / 394 | 392 / 393 |
| Reward / fishing | 267 / 355 | 266 / 354 |
| Might / Favor | 497 | 496 |
| Festivities | 519 | 518 |

Operations, events below the removed entry, handler validation, parse-health
thresholds and bank/deposit guards are unchanged. No ambiguous old loot/profile
aliases are accepted. Festivities retains its existing shape-validated candidates.

## Verification and limits

Run `npm ci --omit=dev --ignore-scripts`, then `npm test`.
Literal 142/143 regressions exercise player-reference updates, valid history and
malformed-profile refusal. Literal 278 checks the real loot sink and rejects the old
279 alias. Chest assignment/removal tests check attribution and prevent double writes.
Historical September fixture bytes are unchanged; a test-only ordinal translation
preserves their field/reconciliation coverage, without claiming current wire evidence.

The capture app must pin the exact reviewed commit when packaging the 0.8.9 hotfix.
These commits do not publish an installer. New live Windows/macOS sessions still need
confirmation after installing the candidate. Missed historical loot cannot be recreated.
The maintenance change must also be reconciled into `protocol18` separately, including
its later journal/trade routes; this release branch does not update that branch.
