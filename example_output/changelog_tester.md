# Tester changelog

## Release v1.0.176+36
**Date:** 2026-04-09 12:44:35
**From:** test-v1.0.175+33 **To:** 4073631c


## Main app

#### a80cf69c — Update submodule references for data, member_module, and setting_module


#### 8697b9f3 — Prepare release test-v1.0.176+36


#### 932c82d1 — update modules


#### cfad1ea5 — update modules and trans


#### 0945e6d3 — Prepare release test-v1.0.176+35


#### adaca3f9 — Add new translation strings for yearly, reset time, and next time in English, Malay, and Chinese; update translation metadata.


#### d2394652 — update submodules


#### 6e142aa5 — update skills


#### e7a6ab64 — Update release metadata for version 1.0.176+34, add new translation strings for 'combo' and 'example' in English, Malay, and Chinese, and update asset submodule reference.


#### d4c66b2a — update pr creator skill


#### 91a22a89 — Prepare release test-v1.0.176+34


#### 1dbfbc7d — Add new translation strings for numbering, appearance, display, display setting, and receipt display setting in English, Malay, and Chinese; update member voucher screen layout with additional spacing.


#### fbdf2883 — Update submodule references for data, history_module, inventory_module, and setting_module


#### c041162e — Update submodule references for data, tunai_style, and appt_module


#### 25db06ee — Update translation strings for outlet permissions and restore manual top-up and view quotation entries in English, Malay, and Chinese; update asset submodule reference.


#### 80ccc6d0 — update skill


#### 74cf5ef1 — Add new translation strings for delivery settings and reasons in English, Malay, and Chinese


#### 0aac38a1 — Update submodule references for asset, history_module, report_module, and setting_module


#### 004409c1 — Update Podfile.lock with new dependency checksums and versions


#### 39ad2082 — Update submodule references and dependencies in pubspec.lock and pubspec.yaml


## Submodules

### appt_module

**Path:** lib/general_module/appt_module
**From:** 1767714 **To:** 4d43ad3

#### 4d43ad3 — feat/recurring-series-edit-scope (#38)

* feat: support recurring series edit scope for appointments
* fix: requested changes from kudin
* styling


#### 9c0377d — style: task styling


#### 13164bc — style: update rotate staff icon


#### 3cba5d3 — feat/staff-task-view-2-and-spa-task-ui (#37)

* feat: staff task view v2, task forms, and spa task UI updates
Made-with: Cursor
* only show rotate staff on task detail


#### 50ad700 — chore: remove unused


#### 9b9cb46 — refactor: remove unused num_extension imports and replace sizedBox with TunaiSpace in various widgets (#35)

- add support for other outlet appt for ApptBox


### member_module

**Path:** lib/general_module/member_module
**From:** cea6dda **To:** 0207741

#### 02077413 — refactor: improve layout and spacing in MemberDocumentTile widget


#### 01297410 — feat: enhance appointment handling and UI adjustments in member appointment screens (#46)

- support shared appt for member view


#### 7cf390a8 — refactor: extract voucher detail into section widgets (#50)

Made-with: Cursor


#### 1f455915 — TUNAI-527: add member address editor UI flow (#49)

### Changes
- Add member address editor dialog flow in member profile screen.
- Add reusable address row and address type icon widgets for address list rendering.
- Update member address field behavior to support richer add/edit interactions.

### User Visible Changes
- Users can add/edit member addresses with improved UI and clearer address type display in profile.

### Risk Level
- Medium: touches member profile form flow and new dialog interactions, which may affect address editing UX if regressions occur.

Made with [Cursor](https://cursor.com)


#### 5e9c851c — refactor: enhance voucher detail screen layout and styling with context-aware colors and consistent padding (#48)

### Internal Changes
- enhance voucher detail screen layout and styling with context-aware colors and consistent padding

### Risk Level
Low


### history_module

**Path:** lib/general_module/history_module
**From:** 4c21fc7 **To:** 4c34f3c

#### 4c34f3c — Feature/order_otem_remark (#57)

* feat: add remark display in OrderCompletedContent for enhanced user feedback
- Implemented a new feature to display remarks in the OrderCompletedContent widget when available, improving user experience by providing additional context.
- Introduced a helper method, _buildRemark, to format and present the remark alongside an icon, ensuring a consistent visual style.
* refactor: enhance OrderCompletedContent functionality and code clarity
- Introduced a helper method, _skuFromCompletedDetail, to streamline SKU handling in OrderCompletedContent.
- Refactored the showVoidedDialog method to a static context for better encapsulation.
- Simplified the grouping logic in groupByGroupID and improved readability by using putIfAbsent.
- Cleaned up unused code and improved variable naming for clarity.
- Updated widget build methods for consistency and maintainability.


#### 61a5d97 — refactor: update member repository references and improve UI consistency in customer and staff content pages (#54)

- Replaced SmallMemberRepo with MemberRepo in NewHistoryMain and NewHistoryCubit for better repository management.
- Enhanced MemberInfoRow usage in CustomerDetailsPage and CustomerContentPage for improved clarity.
- Adjusted spacing and layout in StaffContentPage to ensure consistent presentation across different device types.


### setting_module

**Path:** lib/general_module/setting_module
**From:** 1433c36 **To:** 775e60d

#### 775e60d4 — Chore/translation_cleanup (#194)

* feat: enhance receipt settings UI with new title field and improved layout
- Added a new TunaiTextFieldTile for customizing the document title in the receipt settings.
- Updated section headers for clarity, changing "configuration" to "appearance" and adding a new "payment" section.
- Removed several TunaiSwitchTile components to streamline the UI and improve user experience.
* fix: update URL in BrandPage to point to development environment
- Changed the URL in BrandPage from production to development for testing purposes.
- Updated the displayed URL in the UI to reflect the new development link.
* fix: update URL in BrandPage and enhance receipt settings dialog
- Changed the URL in BrandPage to point to the booking environment.
- Refactored receipt number type selection to use a dialog for improved user experience.
- Made the save button in the receipt display settings dialog conditional based on the ability to save.
* refactor: improve code readability and localization in receipt dialogs
- Reformatted the updateReceiptConf call for better readability in ReceiptAdvanceContent.
- Changed the variable dividerIndent to final for clarity in ReceiptDisplaySettingDialog.
- Updated text references in ReceiptNumberTypeDialog to use localized strings for reset times and next time information, enhancing internationalization support.


#### 77da7695 — Feature/uploadable_experiment (#192)

* feat: add new data control upload functionality and related UI components
* refactor: update import paths and enhance CSV header for supplier SKU upload functionality
* feat: add SkuSectionFolderUploadDialog and integrate with upload menu
* feat: enhance upload dialog with pause/resume functionality and progress display
- Added pause and resume buttons to the upload dialog, allowing users to control the upload process.
- Implemented progress tracking in the upload dialog, displaying current progress and percentage.
- Refactored upload state management to improve responsiveness and user experience.
- Updated error handling for supplier SKU upload to ensure safe parsing of update IDs.
* feat: add member remarks upload functionality and improve error handling
- Introduced a new upload menu item for member remarks in the data control screen, linking it to the MemberRemarkUploadManager and associated dialog.
- Enhanced the MemberUploadDialog to format mobile numbers correctly and improved error messages for better clarity.
- Updated the SupplierSkuUploadDialog to enforce data format validation, ensuring the number of columns is within expected limits and providing clearer error feedback.
* refactor: reorganize upload dialog imports and enhance upload menu items
- Updated import paths for upload-related classes to reflect the new directory structure, improving code organization.
- Expanded the upload menu items in the NewDataControlScreen to include additional upload functionalities for various member-related data, enhancing the upload capabilities of the application.
- Adjusted the uploadManager type in UploadMenuItem to be more flexible, accommodating different upload scenarios.
* feat: enhance upload functionality in NewDataControlScreen
- Added new upload menu items for various data types including service duration, package vouchers, SKU updates, and custom menu items, expanding the upload capabilities of the application.
- Updated import statements to include new upload managers and dialogs, improving code organization and maintainability.
- Enhanced the user interface by integrating additional upload options, allowing for a more comprehensive data management experience.
* feat: add custom font support in member document upload
- Integrated NotoSansSC-Regular.ttf font into the UploadMemberDocument class for enhanced text styling in PDF generation.
- Updated text style in the PDF document to utilize the new font, improving the visual presentation of uploaded member documents.
* feat: add delete member vouchers upload functionality
- Introduced a new upload menu item for deleting member vouchers in the NewDataControlScreen, linked to the VoucherDeleteUploadManager and associated dialog.
- Updated import statements to include the new voucher delete upload manager and dialog, enhancing the upload capabilities of the application.
* refactor: update SKU upload dialog to use section and folder names
- Replaced sectionID and folderID with section name and folder name in the SkuServiceCsvUploadDialog for improved clarity and usability.
- Removed unused imports and section/folder fetching logic to streamline the upload process and enhance code maintainability.
* refactor: streamline SKU upload dialogs by replacing IDs with names
- Updated SkuPackageCsvUploadDialog and SkuProductCsvUploadDialog to use section and folder names instead of IDs for improved clarity.
- Removed unused imports and eliminated unnecessary fetching of sections and folders, enhancing code maintainability and simplifying the upload process.
* refactor: enhance upload dialogs with numeric validation and formatting
- Updated various upload dialogs to utilize UploadCsvNumeric for parsing and validating numeric fields, ensuring non-negative values for credits, points, and prices.
- Improved mobile number formatting and error handling across member-related upload dialogs for better data integrity and user experience.
- Removed redundant parsing logic and streamlined the upload process, enhancing code maintainability.
* refactor: consolidate upload settings by removing obsolete dialogs and enhancing data control screen
- Deleted unused upload dialogs for deleting car members, members, pets, SKUs, and updating member details, streamlining the upload process.
- Updated the data control screen to include new upload managers for various member-related functionalities, improving code organization and maintainability.
- Enhanced import statements to reflect the removal of deprecated files and the addition of new upload managers.
* refactor: reorganize upload dialogs and enhance data control service
- Removed obsolete upload dialog files for various member-related functionalities, including appointment, custom menu items, and member details, to streamline the upload process.
- Updated import statements to reflect the new structure and improve code organization.
- Enhanced the DataControlExportService by consolidating repository initializations, improving maintainability and clarity.
* refactor: enhance data control screen layout and padding
- Updated the padding of the SingleChildScrollView to include bottom padding based on the device's bottom safe area, improving layout responsiveness.


#### 99ffbdf6 — Revamp/receipt_setting (#193)

* feat: enhance receipt settings UI with new title field and improved layout
- Added a new TunaiTextFieldTile for customizing the document title in the receipt settings.
- Updated section headers for clarity, changing "configuration" to "appearance" and adding a new "payment" section.
- Removed several TunaiSwitchTile components to streamline the UI and improve user experience.
* fix: update URL in BrandPage to point to development environment
- Changed the URL in BrandPage from production to development for testing purposes.
- Updated the displayed URL in the UI to reflect the new development link.
* fix: update URL in BrandPage and enhance receipt settings dialog
- Changed the URL in BrandPage to point to the booking environment.
- Refactored receipt number type selection to use a dialog for improved user experience.
- Made the save button in the receipt display settings dialog conditional based on the ability to save.


#### 924af28d — Chore/ui_standardise (#191)

* style: adjust divider indentation in PermissionListWidget for improved layout
* feat: integrate translation for no permissions message in PermissionListWidget
- Added translation support for the "No Permissions Available" message, replacing it with a localized string for better user experience.
- Wrapped the message in a Padding widget for improved layout consistency.
* style: replace Padding with TunaiContainer in PermissionListWidget for improved layout
- Updated the layout of the "No Outlet Permissions For Assignment" message by replacing the Padding widget with TunaiContainer for better styling.
- Adjusted padding and background color to enhance visual consistency.


#### 07a376a3 — refactor: streamline receipt setup fetching logic in ReceiptSetupRepo (#187)

- Simplified the fetch method to return a default ReceiptConf instance if the fetched receiptSetup is null, improving error handling.
- Removed the explicit null check and exception throwing for a cleaner code structure.


### report_module

**Path:** lib/general_module/report_module
**From:** 595dcd6 **To:** 058507c

#### 058507c1 — feat: add recurringID in base appt


#### 5e38c9e1 — Feat/custom comm enhancement (#66)

* Json Upload is Done
* Better indicator of data


#### 41ebe790 — Display Fix (#65)

* Display Fix
* COnssitent Patch for Deleted Member


### new_order_module

**Path:** lib/general_module/new_order_module
**From:** 53b3242 **To:** ef70b9a

#### ef70b9a — TUNAI-555: apply menu discount when creating otem (#63)

Made-with: Cursor


#### 55125e3 — fix: recalculate staff effort/hof when otem price change in walkin


#### b9a98f3 — feat: max staff length 4 for walk in


### tunai_style

**Path:** lib/tunai_style
**From:** 6eedadf **To:** 1802967

#### 1802967 — refactor: update GroupedDrawerItemButton height and alignment for improved layout (#117)

### Internal Changes
- update GroupedDrawerItemButton height and alignment for improved layout

### Risk Level
Low


#### f1493a7 — TUNAI-555: show menu discounted sku prices in row (#116)

Made-with: Cursor


#### 6af64ca — fix/sku-picker (#115)

* feat: hide sku section with empty skus
* fix: sku sections disappear after drag to reorder
* fix: hide restricted custom menus


#### e45967b — feat: max selected staff length for multi staff picker


#### 1f02685 — feat: add onTap callback to DrawerItem and update GroupedDrawerItemButton to handle item selection (#114)

### Internal Changes
- add onTap callback to DrawerItem and update GroupedDrawerItemButton to handle item selection

### Risk Level
Low


#### d19aba3 — fix: wrong on reorder logic


#### 7ea0258 — Changes (#113)

### Internal Changes
- Switch BaseFilter Widget to TunaiOptionMenu

### User Visible Changes
- Download File Icon in CustomDataTable change to Non Filled Version


### asset

**Path:** asset
**From:** f67e33f **To:** 2e843b8

#### 2e843b8 — trans


#### 49ea88e — Add new translation strings for "yearly", "resetTime", and "nextTime" to English, Malay, and Chinese localization files to enhance user interface clarity.


#### caa554e — Merge


#### ebce444 — Add new translation strings "combo" and "example" to English, Malay, and Chinese localization files to enhance user interface clarity.


#### a4909ab — trans


#### 4c6bd73 — Add new translation strings "numbering", "appearance", "display", "displaySetting", and "receiptDisplaySetting" to English, Malay, and Chinese localization files to enhance user interface clarity.


#### 94f37bd — Add new translation string "noOutletPermissionsForAssignment" to English, Malay, and Chinese localization files to enhance user interface clarity.


#### 1f6dc21 — Add new translation string "reason" to English, Malay, and Chinese localization files to enhance user interface clarity.


#### 2e6033f — Add usage descriptions for photo library access in Info.plist to inform users about image saving and selection features.


#### 800b94b — Add new translation string "deliverySetting" to English, Malay, and Chinese localization files to enhance user interface clarity.


### alan_report_module

**Path:** lib/general_module/alan_report_module
**From:** a9ac051 **To:** ecaab63

#### ecaab63 — Feat-add-qtem-remarks (#155)

* feat: add remarks field to Qtem model and related components
- Introduced a new `remarks` field in the Qtem model to capture additional information.
- Updated constructors, JSON parsing, and database handling to accommodate the new `remarks` field.
- Enhanced UI components to display and edit remarks in various dialogs and forms.
- Modified relevant cubits and services to handle remarks during quotation updates and item management.
* feat: integrate selected staff handling in quotation item processing
- Added support for passing the selected staff to the quotation item dialog and order handler.
- Enhanced order creation logic to utilize the selected staff for item processing, including staff-specific calculations for effort and handon.
- Implemented a method to resolve staff details based on the selected staff, improving the robustness of staff management in quotations.
* feat: enhance quotation PDF generation with remarks support
- Updated the BasicQuotationPdf class to include remarks in item grouping and display.
- Modified the QuotationPdfHandler to pass remarks when adding items to quotations.
- Refactored the addQtemToQuotation method in QtemRepo to use named parameters for clarity.
- Enhanced the ReceiptItemQuotation model to accommodate remarks, improving data handling in receipts.


### inventory_module

**Path:** lib/general_module/inventory_module
**From:** v1.0.29 **To:** bbffacd

#### bbffacd — refactor: enhance layout and spacing in StockDetailScreen and StockDetailSummaryWidget for improved visual consistency (#80)

### Internal Changes
- enhance layout and spacing in StockDetailScreen and StockDetailSummaryWidget for improved visual consistency

### Risk Level
Low


#### c0d6faa — refactor: update titles in StockInScreen and StockActionDialog for improved clarity and consistency (#79)

### User Visible Changes
- update titles in StockInScreen and StockActionDialog from 'action' to 'reason' for improved clarity and consistency

### Risk Level
Low


### data

**Path:** lib/data
**From:** 7e2469c **To:** 008fa61

#### 008fa61 — feat: enhance ReceiptNumberType with additional properties (#323)

* feat: enhance ReceiptNumberType with additional properties
- Added shortTitle getter for concise representation of receipt types.
- Introduced isCombo, isDaily, isMonthly, and isYearly getters for better type classification.
* feat: localize receipt titles in ReceiptNumberType
- Replaced hardcoded receipt titles with localized strings using the translation file.
- Updated title and shortTitle getters to utilize the new localization approach.


#### eb593de — Changes (#325)

### Changes
- Audit Repo pulls include hidden and. deleted member

### Risk Level
- Small


#### f1613cd — TUNAI-527: add member address type and detail data support (#324)

### Changes
- Extend member address domain models with additional fields needed by address type/details.
- Update member address DB and remote param/service mapping for the new address payload shape.
- Ensure member address data layer reads/writes the new fields consistently.

### User Visible Changes
- None directly; supports the new member address UI flow and data persistence behind the scenes.

### Risk Level
- Medium: updates model serialization and DB/remote mapping, so malformed mappings could affect address save/load.

Made with [Cursor](https://cursor.com)


#### e3133db — Feature/experimental (#321)

* feat: implement uploadable data model with upload queue and supplier SKU handling
* feat: update modelToMap method in SupplierSkuUpload and register outletRepo in ReportInitializer
* feat: refactor Uploadable model and enhance upload queue management
* feat: refactor uploadable system with new base classes and supplier SKU integration
* feat: implement member and SKU upload functionality with status management
* feat: add SKU section folder upload manager and database integration
* feat: enhance upload manager with state management and progress tracking
* feat: add member remark upload database and manager to uploadable initializer
* refactor: remove deprecated member and SKU upload classes and services from the uploadable initializer
* feat: add multiple SKU and related upload classes and managers to the uploadable initializer
* feat: add custom font support for PDF generation in MemberDocumentCsvUploadService
* feat: implement batch upload functionality in BaseUploadManager and BaseUploadService
* feat: update SkuServiceCsvUpload to use sectionName and folderName, and integrate VoucherDeleteUploadDB
* feat: refactor SkuPackageCsvUpload and SkuPackageCsvUploadService to use sectionName and folderName instead of sectionID and folderID
* refactor: replace SmallMemberDBFetcher with BaseMemberMobileDBFetcher across multiple upload services to streamline member fetching process
* feat: add new upload managers and databases for stock, supplier, staff, appointment, and rental item uploads


#### 25c2241 — TUNAI-555: support menu item discount pricing in sku models (#322)

Made-with: Cursor


#### 499b895 — feat: fetch appt with recurring id


#### 9d334ee — feat: add recurring id when creating appt


#### 3717ba0 — feat: add recurringID in base appt


#### ba69db4 — feat: add helper isEligible getter for custom menu


#### fa7dbe5 — refactor: enhance robustness of sku section sort


#### 5ef4a2a — refactor: simplify JSON parsing in BaseSale and related classes (#318)

- Updated BaseSale.fromJson to use default values for optional fields.
- Refactored BigSale to directly use BaseSale.fromJson.
- Removed deprecated BaseSaleDeltaFetcherConverter and related classes.
- Introduced fromJson methods in BaseCollection and Completed for better JSON handling.
- Cleaned up unused imports and classes across the sale module.
- Introduce socket listener for SaleDetailRepo using key 'sale'


#### dce4df7 — refactor: remove kick-off APIs, align appt group endpoints (#320)

Made-with: Cursor


#### 215be44 — feat: staff working types, shift off-day in task staff, create task options (#319)

Made-with: Cursor


---
*Generated on 2026-04-09T04:44:35.556Z by generate-changelog.mjs (tester view)*