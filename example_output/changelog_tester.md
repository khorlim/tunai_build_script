# Tester changelog (PRs)

## Release v1.0.176+36
**Date:** 2026-04-09 12:55:54
**From:** test-v1.0.175+33 **To:** 4073631c

## Main app

*(No PR-linked commits in this range. Squash subjects must include `(#number)`.)*

## Submodules

### appt_module

**Path:** lib/general_module/appt_module
**From:** 1767714 **To:** 4d43ad3

### PR #38 — feat/recurring-series-edit-scope

### Changes
- Added recurring series edit scope model and comparison logic for appointment edits.
- Updated edit/create appointment flows to support saving one occurrence or the entire recurring series.
- Added recurring-series related UI components and list screen updates to reflect scoped edits.

### User Visible Changes
- Users can choose how recurring appointment edits are applied (single occurrence vs entire series).
- Appointment form and appointment list behavior now reflect recurring-series update choices.

### Risk Level
- Medium: touches core appointment edit/create flows and recurring appointment behavior across multiple screens.

Made with [Cursor](https://cursor.com)


### PR #37 — feat/staff-task-view-2-and-spa-task-ui

### Changes
- Add staff task view v2 with cubit state, round tile widget, and integration in task main and related spa task widgets.
- Update task forms (task form, task form widget, add task dialog), task box layout and grid, staff task box, room task timer, room history task appt box, and appt main cubit plus appt time sheet appt box for consistency with the new staff task UI.

### User Visible Changes
- Updated spa staff task experience, task form options, and related appointment time sheet or task presentation.

### Risk Level
Medium — new UI path and form wiring across multiple screens; regression-test spa task main, add task, and time sheet flows.

Made with [Cursor](https://cursor.com)


### PR #35 — refactor: remove unused num_extension imports and replace sizedBox with TunaiSpace in various widgets

### Internal Changes
- add support for other outlet appt for ApptBox
- remove unused num_extension imports and replace sizedBox with TunaiSpace in various widgets

### Risk Level
Low


### member_module

**Path:** lib/general_module/member_module
**From:** cea6dda **To:** 0207741

### PR #46 — feat: enhance appointment handling and UI adjustments in member appointment screens

### Internal Changes
- support shared appt for member view
- enhance appointment handling and UI adjustments in member appointment screens

### Risk Level
Low


### PR #50 — refactor/voucher-detail-section-widgets

### Changes

Split voucher detail UI into dedicated widgets under voucher_detail/widget: header tile, status section, sale section, and info section. Simplified voucher_detail_screen.dart layout and wiring. Minor voucher_list_screen.dart updates aligned with the detail flow.

### User Visible Changes

None expected; layout and behavior should match the previous voucher detail and list screens.

### Risk Level

Low: refactor with extracted widgets only; regression risk is limited to voucher detail and list screens.

Made with [Cursor](https://cursor.com)


### PR #49 — TUNAI-527/feat/member-address-management

### Changes
- Add member address editor dialog flow in member profile screen.
- Add reusable address row and address type icon widgets for address list rendering.
- Update member address field behavior to support richer add/edit interactions.

### User Visible Changes
- Users can add/edit member addresses with improved UI and clearer address type display in profile.

### Risk Level
- Medium: touches member profile form flow and new dialog interactions, which may affect address editing UX if regressions occur.

Made with [Cursor](https://cursor.com)


### PR #48 — refactor: enhance voucher detail screen layout and styling with context-aware colors and consistent padding

### Internal Changes
- enhance voucher detail screen layout and styling with context-aware colors and consistent padding

### Risk Level
Low


### history_module

**Path:** lib/general_module/history_module
**From:** 4c21fc7 **To:** 4c34f3c

### PR #57 — Feature/order_otem_remark

### Internal Changes
- Introduced a helper method, _skuFromCompletedDetail, to streamline SKU handling in OrderCompletedContent.
- Simplified the grouping logic in groupByGroupID and improved readability by using putIfAbsent.
- Cleaned up unused code and improved variable naming for clarity.

### Risk Level
Low


### PR #54 — refactor: update member repository references and improve UI consistency in customer and staff content pages

### Internal Changes
- Replaced SmallMemberRepo with MemberRepo in NewHistoryMain and NewHistoryCubit for better repository management.
- Enhanced MemberInfoRow usage in CustomerDetailsPage and CustomerContentPage for improved clarity.
- Adjusted spacing and layout in StaffContentPage to ensure consistent presentation across different device types.

### Risk Level
Low


### setting_module

**Path:** lib/general_module/setting_module
**From:** 1433c36 **To:** 775e60d

### PR #194 — Chore/translation_cleanup

### Internal Changes
- Changed the variable dividerIndent to final for clarity in ReceiptDisplaySettingDialog.
- Updated text references in ReceiptNumberTypeDialog to use localized strings for reset times and next time information, enhancing internationalization support.

### Risk Level
Low


### PR #192 — Feature/uploadable_experiment

### Internal Changes
- Totally revamp DataControlScreen to use new uploadable format that supports background upload and progress indicator.
- New engine, same interface

### Risk Level
Medium (each unit need to be tested by Kelvin)


### PR #193 — Revamp/receipt_setting

### User Visible Changes
- Refactored receipt number type selection and receipt display to use a dialog for improved user experience.
- Refactored overall design of receipt advance page

### Risk Level
Low


### PR #191 — Chore/ui_standardise

### User visible changes
- Added translation support for the "No Permissions Available" message, replacing it with a localized string for better user experience.
- Put dividerIndent for TunaiListSection for better consistency

### Risk Level
Low


### PR #187 — refactor: streamline receipt setup fetching logic in ReceiptSetupRepo

### Internal Changes
- Simplified the fetch method to return a default ReceiptConf instance if the fetched receiptSetup is null, improving error handling.
- Removed the explicit null check and exception throwing for a cleaner code structure.

### Risk Level
Low


### report_module

**Path:** lib/general_module/report_module
**From:** 595dcd6 **To:** 058507c

### PR #66 — Feat/custom comm enhancement

Description:
### Internal Changes
- Show Correlated Data in Custom Commission Data Details
- Added Json Importer and Exporter for Comm Scheme

### Risk Level
Medium


### PR #65 — Display Fix


### new_order_module

**Path:** lib/general_module/new_order_module
**From:** 53b3242 **To:** ef70b9a

### PR #63 — TUNAI-555/fix/apply-menu-discount-when-creating-otem

### Changes
- Updated createOtem flow to derive applyDiscount from menu item discount when explicit discount is not provided.
- Consolidated applyPrice and applyDiscount values and reused them for local state update and API calls.
- Passed computed price and discount in redeem createOtem request to keep totals consistent.

### User Visible Changes
- Newly created order items now automatically apply menu discount pricing consistently.

### Risk Level
- Medium - affects order item pricing and discount values sent to create order item endpoints.

Made with [Cursor](https://cursor.com)


### tunai_style

**Path:** lib/tunai_style
**From:** 6eedadf **To:** 1802967

### PR #117 — refactor: update GroupedDrawerItemButton height and alignment for improved layout

### Internal Changes
- update GroupedDrawerItemButton height and alignment for improved layout

### Risk Level
Low


### PR #116 — TUNAI-555/feat/show-menu-discounted-sku-price

### Changes
- Updated sku info row price rendering to compute outlet base price, menu discount, and final price.
- Added discounted price presentation with strikethrough on original price when menu discount exists.
- Normalized title spacing to TunaiSpacing.small to keep row spacing consistent.

### User Visible Changes
- SKU rows now show original and discounted prices when an item has menu discount.

### Risk Level
- Low - UI-only price display update based on existing sku pricing helpers.

Made with [Cursor](https://cursor.com)


### PR #115 — fix/sku-picker

### Changes
SKU picker and custom menu picker behavior: hide SKU sections that have no selectable SKUs; fix sections vanishing after drag-to-reorder; hide custom menu options that are restricted by menu rules (e.g. member rules) so users do not see invalid choices.

### User Visible Changes
Empty SKU groups stay collapsed or hidden where appropriate; reordering SKU sections no longer leaves sections missing; restricted custom menus no longer appear as selectable options in the picker.

### Risk Level
Medium. Touches picker visibility and ordering logic; regressions could hide valid options or affect layout after reorder.

Made with [Cursor](https://cursor.com)


### PR #114 — feat: add onTap callback to DrawerItem and update GroupedDrawerItemButton to handle item selection

### Internal Changes
- add onTap callback to DrawerItem and update GroupedDrawerItemButton to handle item selection

### Risk Level
Low


### PR #113 — Changes

### Internal Changes
- Switch BaseFilter Widget to TunaiOptionMenu

### User Visible Changes
- Download File Icon in CustomDataTable change to Non Filled Version


### asset

**Path:** asset
**From:** f67e33f **To:** 2e843b8

*(No PR-linked commits in this range. Squash subjects must include `(#number)`.)*

### alan_report_module

**Path:** lib/general_module/alan_report_module
**From:** a9ac051 **To:** ecaab63

### PR #155 — Feat-add-qtem-remarks

### Internal Changes
- Added support for passing the selected staff to the quotation item dialog and order handler.
- Enhanced order creation logic to utilize the selected staff for item processing, including staff-specific calculations for effort and handon.
- Implemented a method to resolve staff details based on the selected staff, improving the robustness of staff management in quotations.

### User Visible Changes
- Able to assign staff and qtem remark 

### Risk Level 
- Medium


### inventory_module

**Path:** lib/general_module/inventory_module
**From:** v1.0.29 **To:** bbffacd

### PR #80 — refactor: enhance layout and spacing in StockDetailScreen and StockDetailSummaryWidget for improved visual consistency

### Internal Changes
- enhance layout and spacing in StockDetailScreen and StockDetailSummaryWidget for improved visual consistency

### Risk Level
Low


### PR #79 — refactor: update titles in StockInScreen and StockActionDialog for improved clarity and consistency

### User Visible Changes
- update titles in StockInScreen and StockActionDialog from 'action' to 'reason' for improved clarity and consistency

### Risk Level
Low


### data

**Path:** lib/data
**From:** 7e2469c **To:** 008fa61

### PR #323 — feat: enhance ReceiptNumberType with additional properties

### Internal Changes
- Added shortTitle getter for concise representation of receipt types.
- Introduced isCombo, isDaily, isMonthly, and isYearly getters for better type classification.

### Risk Level
Low


### PR #325 — Changes

### Changes
- Audit Repo pulls include hidden and. deleted member

### Risk Level
- Small


### PR #324 — TUNAI-527/feat/member-address-management

### Changes
- Extend member address domain models with additional fields needed by address type/details.
- Update member address DB and remote param/service mapping for the new address payload shape.
- Ensure member address data layer reads/writes the new fields consistently.

### User Visible Changes
- None directly; supports the new member address UI flow and data persistence behind the scenes.

### Risk Level
- Medium: updates model serialization and DB/remote mapping, so malformed mappings could affect address save/load.

Made with [Cursor](https://cursor.com)


### PR #321 — Feature/experimental

### Internal Changes
- Introduce Uploadable concept with their supporting cast; BaseUploadManager, BaseUploadService, UploadableDB and UploadableInitializer
- Fully migrate DataControlScreen unit to their own Uploadable entity to support background loading, progress bar and improve state management

### Risk Level
Medium; each unit need to be tested by Kelvin


### PR #322 — TUNAI-555/feat/support-menu-item-discount-pricing

### Changes
- Added menuItem to Sku and wired copyWith and equality handling for nullable props.
- Added menu item discount and final price helpers, and updated redeemable credit filtering to use final discounted price.
- Preserved menu item info when composing sku from custom menu and aligned Equatable props nullability in related models.

### User Visible Changes
- Credit redeem and related sku pricing now respect custom menu item discount values.

### Risk Level
- Medium - pricing and redeem eligibility logic changed and can affect order totals when custom menu discounts are applied.

Made with [Cursor](https://cursor.com)


### PR #318 — refactor: simplify JSON parsing in BaseSale and related classes

### Internal Changes
- simplify JSON parsing in BaseSale and related classes
- Updated BaseSale.fromJson to use default values for optional fields.
- Refactored BigSale to directly use BaseSale.fromJson.
- Removed deprecated BaseSaleDeltaFetcherConverter and related classes.
- Introduced fromJson methods in BaseCollection and Completed for better JSON handling.
- Cleaned up unused imports and classes across the sale module.
- Introduce socket listener for SaleDetailRepo using key 'sale'

### Risk Level
High (touch sale, completed, collection)


### PR #320 — refactor/appt-kickoff-removal-and-api-updates

### Changes

- Removed ApptKickOffUseCase registration from ApptInitializer and deleted startKickOff/stopKickOff from BaseApptRepo, BaseApptRemoteService, and BaseApptRemoteServiceImp2 (including spaloyalty kickoff URLs).
- Updated ApptGroupIDRemoteService to call appt2.tunai.io for group generation and to read groupID from the top-level JSON response.
- Removed the redundant _editAppt call block and the private _editAppt helper from BaseApptRemoteServiceImp2.
- Changed the book group endpoint to use the configured apptUrl with the appts path instead of a hardcoded appt.tunai.io URL.

### User Visible Changes

Appointment group ID generation and group assignment now use the updated endpoints and response shape. Kick-off start/stop is no longer exposed from this data layer; any UI still calling removed APIs must be updated in the app modules.

### Risk Level

Medium — backend URL and response contract changes for group ID, plus removal of kick-off and the old inline edit path; verify group booking and any remaining kick-off flows against production or staging before release.

Made with [Cursor](https://cursor.com)


### PR #319 — feat/staff-shift-off-day-and-task-create-options

### Changes
- Add StaffWorkingType enum and a workingTypes getter on BaseStaff derived from showWork, showAppt, and showOnline flags.
- Wire StaffShiftDetailRepo into TaskInitializer and TaskStaffUseCase: sync shift details with other task staff sync work, and exclude staff on default off-day shifts when building task staff lists.
- CreateTaskUseCase: default new task start time to now plus five minutes; add rotateStaff flag on CreateTaskParams (default true) so rotate updates run only when requested.

### User Visible Changes
- Task creation timing and staff rotation behavior may differ from before; staff on off-day shift patterns can be hidden from task staff selection flows that use TaskStaffUseCase filtering.

### Risk Level
Medium — behavior changes to who appears in task staff lists and when staff rotate on create affect appointment and spa task workflows; verify with real shift data and create-task flows.

Made with [Cursor](https://cursor.com)


---
*Generated on 2026-04-09T04:55:54.873Z by generate-changelog.mjs (tester PR view)*