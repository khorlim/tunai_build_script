# Tester changelog

## Release v1.0.176+36
**Date:** 2026-04-09 12:28:54
**From:** test-v1.0.175+33 **To:** 4073631c

*Built from squash merge bodies. Expected sections: `### User Visible Changes`, `### Risk Level` (headings are matched case-insensitively).*

## Main app

### Missing PR tester sections — main app

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

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

### Missing PR tester sections — appt_module (lib/general_module/appt_module)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

- 4d43ad3 — feat/recurring-series-edit-scope (#38)
- 9c0377d — style: task styling
- 13164bc — style: update rotate staff icon
- 3cba5d3 — feat/staff-task-view-2-and-spa-task-ui (#37)
- 50ad700 — chore: remove unused
- 9b9cb46 — refactor: remove unused num_extension imports and replace sizedBox with TunaiSpace in various widgets (#35)

### member_module

**Path:** lib/general_module/member_module
**From:** cea6dda **To:** 0207741

### Missing PR tester sections — member_module (lib/general_module/member_module)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

- 02077413 — refactor: improve layout and spacing in MemberDocumentTile widget
- 01297410 — feat: enhance appointment handling and UI adjustments in member appointment screens (#46)
- 7cf390a8 — refactor: extract voucher detail into section widgets (#50)
- 1f455915 — TUNAI-527: add member address editor UI flow (#49)
- 5e9c851c — refactor: enhance voucher detail screen layout and styling with context-aware colors and consistent padding (#48)

### history_module

**Path:** lib/general_module/history_module
**From:** 4c21fc7 **To:** 4c34f3c

### Missing PR tester sections — history_module (lib/general_module/history_module)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

- 4c34f3c — Feature/order_otem_remark (#57)
- 61a5d97 — refactor: update member repository references and improve UI consistency in customer and staff content pages (#54)

### setting_module

**Path:** lib/general_module/setting_module
**From:** 1433c36 **To:** 775e60d

### Missing PR tester sections — setting_module (lib/general_module/setting_module)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

- 775e60d4 — Chore/translation_cleanup (#194)
- 77da7695 — Feature/uploadable_experiment (#192)
- 99ffbdf6 — Revamp/receipt_setting (#193)
- 924af28d — Chore/ui_standardise (#191)
- 07a376a3 — refactor: streamline receipt setup fetching logic in ReceiptSetupRepo (#187)

### report_module

**Path:** lib/general_module/report_module
**From:** 595dcd6 **To:** 058507c

### Missing PR tester sections — report_module (lib/general_module/report_module)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

- 058507c1 — feat: add recurringID in base appt
- 5e38c9e1 — Feat/custom comm enhancement (#66)
- 41ebe790 — Display Fix (#65)

### new_order_module

**Path:** lib/general_module/new_order_module
**From:** 53b3242 **To:** ef70b9a

### Missing PR tester sections — new_order_module (lib/general_module/new_order_module)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

- ef70b9a — TUNAI-555: apply menu discount when creating otem (#63)
- 55125e3 — fix: recalculate staff effort/hof when otem price change in walkin
- b9a98f3 — feat: max staff length 4 for walk in

### tunai_style

**Path:** lib/tunai_style
**From:** 6eedadf **To:** 1802967

### Missing PR tester sections — tunai_style (lib/tunai_style)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

- 1802967 — refactor: update GroupedDrawerItemButton height and alignment for improved layout (#117)
- f1493a7 — TUNAI-555: show menu discounted sku prices in row (#116)
- 6af64ca — fix/sku-picker (#115)
- e45967b — feat: max selected staff length for multi staff picker
- 1f02685 — feat: add onTap callback to DrawerItem and update GroupedDrawerItemButton to handle item selection (#114)
- d19aba3 — fix: wrong on reorder logic
- 7ea0258 — Changes (#113)

### asset

**Path:** asset
**From:** f67e33f **To:** 2e843b8

### Missing PR tester sections — asset (asset)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

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

### Missing PR tester sections — alan_report_module (lib/general_module/alan_report_module)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

- ecaab63 — Feat-add-qtem-remarks (#155)

### inventory_module

**Path:** lib/general_module/inventory_module
**From:** v1.0.29 **To:** bbffacd

### Missing PR tester sections — inventory_module (lib/general_module/inventory_module)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

- bbffacd — refactor: enhance layout and spacing in StockDetailScreen and StockDetailSummaryWidget for improved visual consistency (#80)
- c0d6faa — refactor: update titles in StockInScreen and StockActionDialog for improved clarity and consistency (#79)

### data

**Path:** lib/data
**From:** 7e2469c **To:** 008fa61

### Missing PR tester sections — data (lib/data)

*No tester sections in the commit body, no `(#number)` in the subject for GitHub lookup, or PR fetch failed. Use the engineering changelog or ask the author.*

- 008fa61 — feat: enhance ReceiptNumberType with additional properties (#323)
- eb593de — Changes (#325)
- f1613cd — TUNAI-527: add member address type and detail data support (#324)
- e3133db — Feature/experimental (#321)
- 25c2241 — TUNAI-555: support menu item discount pricing in sku models (#322)
- 499b895 — feat: fetch appt with recurring id
- 9d334ee — feat: add recurring id when creating appt
- 3717ba0 — feat: add recurringID in base appt
- ba69db4 — feat: add helper isEligible getter for custom menu
- fa7dbe5 — refactor: enhance robustness of sku section sort
- 5ef4a2a — refactor: simplify JSON parsing in BaseSale and related classes (#318)
- dce4df7 — refactor: remove kick-off APIs, align appt group endpoints (#320)
- 215be44 — feat: staff working types, shift off-day in task staff, create task options (#319)

---
*Generated on 2026-04-09T04:28:54.999Z by generate-changelog.mjs (tester view)*