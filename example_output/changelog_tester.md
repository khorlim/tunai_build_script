# Tester changelog

## Release v1.0.176+36
**Date:** 2026-04-09 12:38:52
**From:** test-v1.0.175+33 **To:** 4073631c

*Built from squash merge bodies. Expected sections: `### User Visible Changes`, `### Risk Level` (headings are matched case-insensitively).*
*PR bodies load via **GitHub CLI** (`gh pr view`) when the subject contains `(#123)` and the commit body has no tester sections, if `gh auth login` succeeded. Use **--no-fetch-github-pr** to skip. Repo = each checkout’s `origin` (submodules use the submodule remote).*

## Main app

#### No PR number in subject — main app

*No `(#number)` in the squash subject and no tester sections in the commit body — nothing to match on GitHub. Use the engineering changelog or ask the author to add `(#N)` or template sections.*

- a80cf69c — Update submodule references for data, member_module, and setting_module
- 8697b9f3 — Prepare release test-v1.0.176+36
- 932c82d1 — update modules
- cfad1ea5 — update modules and trans
- 0945e6d3 — Prepare release test-v1.0.176+35
- adaca3f9 — Add new translation strings for yearly, reset time, and next time in English, Malay, and Chinese; update translation metadata.
- d2394652 — update submodules
- 6e142aa5 — update skills
- e7a6ab64 — Update release metadata for version 1.0.176+34, add new translation strings for 'combo' and 'example' in English, Malay, and Chinese, and update asset submodule reference.
- d4c66b2a — update pr creator skill
- 91a22a89 — Prepare release test-v1.0.176+34
- 1dbfbc7d — Add new translation strings for numbering, appearance, display, display setting, and receipt display setting in English, Malay, and Chinese; update member voucher screen layout with additional spacing.
- fbdf2883 — Update submodule references for data, history_module, inventory_module, and setting_module
- c041162e — Update submodule references for data, tunai_style, and appt_module
- 25db06ee — Update translation strings for outlet permissions and restore manual top-up and view quotation entries in English, Malay, and Chinese; update asset submodule reference.
- 80ccc6d0 — update skill
- 74cf5ef1 — Add new translation strings for delivery settings and reasons in English, Malay, and Chinese
- 0aac38a1 — Update submodule references for asset, history_module, report_module, and setting_module
- 004409c1 — Update Podfile.lock with new dependency checksums and versions
- 39ad2082 — Update submodule references and dependencies in pubspec.lock and pubspec.yaml

## Submodules

### appt_module

**Path:** lib/general_module/appt_module
**From:** 1767714 **To:** 4d43ad3

#### 4d43ad3 — feat/recurring-series-edit-scope (#38)

**User visible changes**

- Users can choose how recurring appointment edits are applied (single occurrence vs entire series).
- Appointment form and appointment list behavior now reflect recurring-series update choices.

**Risk level**

- Medium: touches core appointment edit/create flows and recurring appointment behavior across multiple screens.

Made with [Cursor](https://cursor.com)


#### 3cba5d3 — feat/staff-task-view-2-and-spa-task-ui (#37)

**User visible changes**

- Updated spa staff task experience, task form options, and related appointment time sheet or task presentation.

**Risk level**

Medium — new UI path and form wiring across multiple screens; regression-test spa task main, add task, and time sheet flows.

Made with [Cursor](https://cursor.com)


#### 9b9cb46 — refactor: remove unused num_extension imports and replace sizedBox with TunaiSpace in various widgets (#35)

**Risk level**

Low


#### No PR number in subject — appt_module (lib/general_module/appt_module)

*No `(#number)` in the squash subject and no tester sections in the commit body — nothing to match on GitHub. Use the engineering changelog or ask the author to add `(#N)` or template sections.*

- 9c0377d — style: task styling
- 13164bc — style: update rotate staff icon
- 50ad700 — chore: remove unused

### member_module

**Path:** lib/general_module/member_module
**From:** cea6dda **To:** 0207741

#### 01297410 — feat: enhance appointment handling and UI adjustments in member appointment screens (#46)

**Risk level**

Low


#### 7cf390a8 — refactor: extract voucher detail into section widgets (#50)

**User visible changes**

None expected; layout and behavior should match the previous voucher detail and list screens.

**Risk level**

Low: refactor with extracted widgets only; regression risk is limited to voucher detail and list screens.

Made with [Cursor](https://cursor.com)


#### 1f455915 — TUNAI-527: add member address editor UI flow (#49)

**User visible changes**

- Users can add/edit member addresses with improved UI and clearer address type display in profile.

**Risk level**

- Medium: touches member profile form flow and new dialog interactions, which may affect address editing UX if regressions occur.

Made with [Cursor](https://cursor.com)


#### 5e9c851c — refactor: enhance voucher detail screen layout and styling with context-aware colors and consistent padding (#48)

**Risk level**

Low


#### No PR number in subject — member_module (lib/general_module/member_module)

*No `(#number)` in the squash subject and no tester sections in the commit body — nothing to match on GitHub. Use the engineering changelog or ask the author to add `(#N)` or template sections.*

- 02077413 — refactor: improve layout and spacing in MemberDocumentTile widget

### history_module

**Path:** lib/general_module/history_module
**From:** 4c21fc7 **To:** 4c34f3c

#### 4c34f3c — Feature/order_otem_remark (#57)

**Risk level**

Low


#### 61a5d97 — refactor: update member repository references and improve UI consistency in customer and staff content pages (#54)

**Risk level**

Low


### setting_module

**Path:** lib/general_module/setting_module
**From:** 1433c36 **To:** 775e60d

#### 775e60d4 — Chore/translation_cleanup (#194)

**Risk level**

Low


#### 77da7695 — Feature/uploadable_experiment (#192)

**Risk level**

Medium (each unit need to be tested by Kelvin)


#### 99ffbdf6 — Revamp/receipt_setting (#193)

**User visible changes**

- Refactored receipt number type selection and receipt display to use a dialog for improved user experience.
- Refactored overall design of receipt advance page

**Risk level**

Low


#### 924af28d — Chore/ui_standardise (#191)

**User visible changes**

- Added translation support for the "No Permissions Available" message, replacing it with a localized string for better user experience.
- Put dividerIndent for TunaiListSection for better consistency

**Risk level**

Low


#### 07a376a3 — refactor: streamline receipt setup fetching logic in ReceiptSetupRepo (#187)

**Risk level**

Low


### report_module

**Path:** lib/general_module/report_module
**From:** 595dcd6 **To:** 058507c

#### 5e38c9e1 — Feat/custom comm enhancement (#66)

**Risk level**

Medium


#### PR linked in subject but not in tester output — report_module (lib/general_module/report_module)

*PR was fetched (or attempted) but the body had no `### User Visible Changes` / `### Risk Level`, the PR description was empty, or GitHub returned an error — see warnings above. You can still use the engineering changelog.*

- 41ebe790 — Display Fix (#65)

#### No PR number in subject — report_module (lib/general_module/report_module)

*No `(#number)` in the squash subject and no tester sections in the commit body — nothing to match on GitHub. Use the engineering changelog or ask the author to add `(#N)` or template sections.*

- 058507c1 — feat: add recurringID in base appt

### new_order_module

**Path:** lib/general_module/new_order_module
**From:** 53b3242 **To:** ef70b9a

#### ef70b9a — TUNAI-555: apply menu discount when creating otem (#63)

**User visible changes**

- Newly created order items now automatically apply menu discount pricing consistently.

**Risk level**

- Medium - affects order item pricing and discount values sent to create order item endpoints.

Made with [Cursor](https://cursor.com)


#### No PR number in subject — new_order_module (lib/general_module/new_order_module)

*No `(#number)` in the squash subject and no tester sections in the commit body — nothing to match on GitHub. Use the engineering changelog or ask the author to add `(#N)` or template sections.*

- 55125e3 — fix: recalculate staff effort/hof when otem price change in walkin
- b9a98f3 — feat: max staff length 4 for walk in

### tunai_style

**Path:** lib/tunai_style
**From:** 6eedadf **To:** 1802967

#### 1802967 — refactor: update GroupedDrawerItemButton height and alignment for improved layout (#117)

**Risk level**

Low


#### f1493a7 — TUNAI-555: show menu discounted sku prices in row (#116)

**User visible changes**

- SKU rows now show original and discounted prices when an item has menu discount.

**Risk level**

- Low - UI-only price display update based on existing sku pricing helpers.

Made with [Cursor](https://cursor.com)


#### 6af64ca — fix/sku-picker (#115)

**User visible changes**

Empty SKU groups stay collapsed or hidden where appropriate; reordering SKU sections no longer leaves sections missing; restricted custom menus no longer appear as selectable options in the picker.

**Risk level**

Medium. Touches picker visibility and ordering logic; regressions could hide valid options or affect layout after reorder.

Made with [Cursor](https://cursor.com)


#### 1f02685 — feat: add onTap callback to DrawerItem and update GroupedDrawerItemButton to handle item selection (#114)

**Risk level**

Low


#### 7ea0258 — Changes (#113)

**User visible changes**

- Download File Icon in CustomDataTable change to Non Filled Version


#### No PR number in subject — tunai_style (lib/tunai_style)

*No `(#number)` in the squash subject and no tester sections in the commit body — nothing to match on GitHub. Use the engineering changelog or ask the author to add `(#N)` or template sections.*

- e45967b — feat: max selected staff length for multi staff picker
- d19aba3 — fix: wrong on reorder logic

### asset

**Path:** asset
**From:** f67e33f **To:** 2e843b8

#### No PR number in subject — asset (asset)

*No `(#number)` in the squash subject and no tester sections in the commit body — nothing to match on GitHub. Use the engineering changelog or ask the author to add `(#N)` or template sections.*

- 2e843b8 — trans
- 49ea88e — Add new translation strings for "yearly", "resetTime", and "nextTime" to English, Malay, and Chinese localization files to enhance user interface clarity.
- caa554e — Merge
- ebce444 — Add new translation strings "combo" and "example" to English, Malay, and Chinese localization files to enhance user interface clarity.
- a4909ab — trans
- 4c6bd73 — Add new translation strings "numbering", "appearance", "display", "displaySetting", and "receiptDisplaySetting" to English, Malay, and Chinese localization files to enhance user interface clarity.
- 94f37bd — Add new translation string "noOutletPermissionsForAssignment" to English, Malay, and Chinese localization files to enhance user interface clarity.
- 1f6dc21 — Add new translation string "reason" to English, Malay, and Chinese localization files to enhance user interface clarity.
- 2e6033f — Add usage descriptions for photo library access in Info.plist to inform users about image saving and selection features.
- 800b94b — Add new translation string "deliverySetting" to English, Malay, and Chinese localization files to enhance user interface clarity.

### alan_report_module

**Path:** lib/general_module/alan_report_module
**From:** a9ac051 **To:** ecaab63

#### ecaab63 — Feat-add-qtem-remarks (#155)

**User visible changes**

- Able to assign staff and qtem remark

**Risk level**

- Medium


### inventory_module

**Path:** lib/general_module/inventory_module
**From:** v1.0.29 **To:** bbffacd

#### bbffacd — refactor: enhance layout and spacing in StockDetailScreen and StockDetailSummaryWidget for improved visual consistency (#80)

**Risk level**

Low


#### c0d6faa — refactor: update titles in StockInScreen and StockActionDialog for improved clarity and consistency (#79)

**User visible changes**

- update titles in StockInScreen and StockActionDialog from 'action' to 'reason' for improved clarity and consistency

**Risk level**

Low


### data

**Path:** lib/data
**From:** 7e2469c **To:** 008fa61

#### 008fa61 — feat: enhance ReceiptNumberType with additional properties (#323)

**Risk level**

Low


#### eb593de — Changes (#325)

**Risk level**

- Small


#### f1613cd — TUNAI-527: add member address type and detail data support (#324)

**User visible changes**

- None directly; supports the new member address UI flow and data persistence behind the scenes.

**Risk level**

- Medium: updates model serialization and DB/remote mapping, so malformed mappings could affect address save/load.

Made with [Cursor](https://cursor.com)


#### e3133db — Feature/experimental (#321)

**Risk level**

Medium; each unit need to be tested by Kelvin


#### 25c2241 — TUNAI-555: support menu item discount pricing in sku models (#322)

**User visible changes**

- Credit redeem and related sku pricing now respect custom menu item discount values.

**Risk level**

- Medium - pricing and redeem eligibility logic changed and can affect order totals when custom menu discounts are applied.

Made with [Cursor](https://cursor.com)


#### 5ef4a2a — refactor: simplify JSON parsing in BaseSale and related classes (#318)

**Risk level**

High (touch sale, completed, collection)


#### dce4df7 — refactor: remove kick-off APIs, align appt group endpoints (#320)

**User visible changes**

Appointment group ID generation and group assignment now use the updated endpoints and response shape. Kick-off start/stop is no longer exposed from this data layer; any UI still calling removed APIs must be updated in the app modules.

**Risk level**

Medium — backend URL and response contract changes for group ID, plus removal of kick-off and the old inline edit path; verify group booking and any remaining kick-off flows against production or staging before release.

Made with [Cursor](https://cursor.com)


#### 215be44 — feat: staff working types, shift off-day in task staff, create task options (#319)

**User visible changes**

- Task creation timing and staff rotation behavior may differ from before; staff on off-day shift patterns can be hidden from task staff selection flows that use TaskStaffUseCase filtering.

**Risk level**

Medium — behavior changes to who appears in task staff lists and when staff rotate on create affect appointment and spa task workflows; verify with real shift data and create-task flows.

Made with [Cursor](https://cursor.com)


#### No PR number in subject — data (lib/data)

*No `(#number)` in the squash subject and no tester sections in the commit body — nothing to match on GitHub. Use the engineering changelog or ask the author to add `(#N)` or template sections.*

- 499b895 — feat: fetch appt with recurring id
- 9d334ee — feat: add recurring id when creating appt
- 3717ba0 — feat: add recurringID in base appt
- ba69db4 — feat: add helper isEligible getter for custom menu
- fa7dbe5 — refactor: enhance robustness of sku section sort

---
*Generated on 2026-04-09T04:38:52.143Z by generate-changelog.mjs (tester view)*