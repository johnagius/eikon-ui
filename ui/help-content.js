(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // ─── Help Content: populated by category ────────────────────────────────
  // Additional modules can be appended to E.HELP_CONTENT in future files.

  E.HELP_CONTENT = [

    // ══════════════════════════════════════════════════════════════════════
    // GENERAL
    // ══════════════════════════════════════════════════════════════════════

    {
      id: "dashboard",
      title: "Dashboard",
      icon: "\uD83D\uDCCA",
      subtitle: "Your pharmacy at a glance \u2014 real-time status, quick entry, and actionable alerts.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>The Dashboard is your central command screen. It loads data from every major module " +
            "in parallel so you see a live snapshot of your pharmacy within seconds of logging in.</p>" +
            "<p>Everything on the dashboard is <strong>read-and-act</strong> \u2014 you can inspect issues " +
            "and take action (quick-entry, returns, stock offers) without leaving the page.</p>"
        },
        {
          heading: "Layout",
          body:
            "<p>The dashboard is divided into three cards:</p>" +
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Card</th><th>Position</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Today</strong></td><td>Top left</td><td>Daily tasks, quick-entry shortcuts, instructions, and chat</td></tr>" +
            "<tr><td><strong>Attention</strong></td><td>Top right</td><td>Compliance items and alerts that need review or action</td></tr>" +
            "<tr><td><strong>Operations</strong></td><td>Bottom (full width)</td><td>Shift coverage, orders, tickets, and supplier status</td></tr>" +
            "</table>"
        },
        {
          heading: "Quick Entry",
          body:
            "<p>Quick-entry buttons let you record data instantly without navigating to the full module:</p>" +
            "<ul>" +
            "<li><strong>Temperature</strong> \u2014 Select device, enter min/max readings, optional notes. " +
            "Only devices missing today\u2019s entry are shown.</li>" +
            "<li><strong>Cleaning</strong> \u2014 Date, time in/out, cleaner name, staff name, notes.</li>" +
            "<li><strong>Daily Register</strong> \u2014 Client name & ID, medicine, posology, prescriber name & reg number.</li>" +
            "<li><strong>Prescription Label</strong> \u2014 Drug name with autocomplete, dose, route, frequency, warnings. Prints immediately.</li>" +
            "</ul>" +
            "<div class=\"eikon-help-tip\"><strong>Tip:</strong> The prescription label remembers your patient names " +
            "and drug entries. Start typing and use arrow keys to navigate suggestions, Enter to select.</div>"
        },
        {
          heading: "Status Indicators",
          body:
            "<p>Each dashboard item shows a coloured status pill:</p>" +
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Colour</th><th>Meaning</th><th>Action</th></tr>" +
            "<tr><td><strong style=\"color:var(--ok)\">Green (OK)</strong></td><td>All checks passed</td><td>No action needed</td></tr>" +
            "<tr><td><strong style=\"color:#e8b635\">Yellow (WARN)</strong></td><td>Minor issues found</td><td>Review when convenient</td></tr>" +
            "<tr><td><strong style=\"color:var(--danger)\">Red (DANGER)</strong></td><td>Requires immediate attention</td><td>Act now</td></tr>" +
            "<tr><td><strong style=\"color:var(--muted)\">Grey (N/A)</strong></td><td>Data unavailable or loading</td><td>Wait or refresh</td></tr>" +
            "</table>" +
            "<p>Cards that <strong>flash red</strong> (Stock Transfers, Scarce Stock) indicate urgent pending actions.</p>"
        },
        {
          heading: "Detail Views & Inline Actions",
          body:
            "<p>Click <strong>Details</strong> on any dashboard item to see a breakdown without leaving the page:</p>" +
            "<ul>" +
            "<li><strong>Certificates</strong> \u2014 Expired and due-soon items with edit capability</li>" +
            "<li><strong>Alerts</strong> \u2014 Incomplete entries showing which fields are missing</li>" +
            "<li><strong>Near Expiry</strong> \u2014 Expired and soon-to-expire items with inline <strong>Return</strong> and <strong>Add to Scarce Stock</strong> buttons</li>" +
            "<li><strong>Shifts</strong> \u2014 Pharmacist coverage issues by date</li>" +
            "<li><strong>Supplier Updates</strong> \u2014 Recent product stock changes from suppliers</li>" +
            "</ul>" +
            "<div class=\"eikon-help-tip\"><strong>Tip:</strong> From Near Expiry details, you can create a return " +
            "or add an item to Scarce Stock directly \u2014 no need to open those modules separately.</div>"
        },
        {
          heading: "Tips & Best Practices",
          body:
            "<ul>" +
            "<li><strong>Use quick-entry over full modules</strong> for routine daily tasks \u2014 it\u2019s significantly faster.</li>" +
            "<li><strong>Click Refresh</strong> to reload all data. Each section loads independently.</li>" +
            "<li><strong>Watch for flashing cards</strong> \u2014 they indicate items requiring immediate action.</li>" +
            "<li><strong>Open buttons</strong> on every card take you directly to the full module for deeper work.</li>" +
            "<li><strong>Supplier Updates</strong> are automatically de-duplicated \u2014 only the latest change per product is shown.</li>" +
            "</ul>"
        },
        {
          heading: "Common Workflows",
          body:
            "<p><strong>Morning check-in:</strong></p>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Open the Dashboard (loads automatically on login)</li>" +
            "<li>Review the Today card \u2014 record temperature, cleaning, and daily register entries via quick-entry</li>" +
            "<li>Check the Attention card \u2014 address any red items</li>" +
            "<li>Glance at Operations \u2014 verify shift coverage and pending client orders</li>" +
            "</ol>" +
            "<p><strong>End-of-day wrap-up:</strong></p>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Refresh the dashboard for latest status</li>" +
            "<li>Ensure all temperature entries are recorded (Today card should show green)</li>" +
            "<li>Review Near Expiry details and create returns for expired items</li>" +
            "<li>Check Instructions for any handover notes</li>" +
            "</ol>"
        }
      ]
    },

    // ══════════════════════════════════════════════════════════════════════
    // INSPECTIONS
    // ══════════════════════════════════════════════════════════════════════

    {
      id: "temperature",
      title: "Temperature",
      icon: "\uD83C\uDF21",
      subtitle: "Monitor and record temperatures for rooms, fridges, and other storage areas.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>The Temperature module tracks daily min/max temperature readings for every monitoring device " +
            "in your pharmacy. It supports rooms, fridges, and custom device types with configurable limits.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Entries</strong></td><td>Record and review daily temperature readings per device</td></tr>" +
            "<tr><td><strong>Devices</strong></td><td>Add, edit, deactivate, and configure monitoring devices</td></tr>" +
            "<tr><td><strong>Print Report</strong></td><td>Generate date-range reports for compliance</td></tr>" +
            "</table>"
        },
        {
          heading: "Entries Tab",
          body:
            "<ul>" +
            "<li><strong>Date picker</strong> \u2014 Defaults to today. Change it to record or review past dates.</li>" +
            "<li><strong>Device table</strong> \u2014 One row per active device. Enter Min and Max for each.</li>" +
            "<li><strong>Status dot</strong> \u2014 " +
            "<strong style=\"color:var(--ok)\">Green</strong> = within limits, " +
            "<strong style=\"color:var(--danger)\">Red</strong> = outside limits, " +
            "<strong style=\"color:var(--muted)\">Grey</strong> = missing.</li>" +
            "<li><strong>Save</strong> \u2014 Saves all entries for the selected date.</li>" +
            "</ul>" +
            "<div class=\"eikon-help-tip\"><strong>Tip:</strong> Check status dots before saving. " +
            "A red dot means the reading is outside limits \u2014 recorded as-is but flagged for review.</div>"
        },
        {
          heading: "Devices Tab",
          body:
            "<ul>" +
            "<li><strong>Add a device</strong> \u2014 Name (required), type (room/fridge/other), optional min/max limits.</li>" +
            "<li><strong>Deactivate</strong> \u2014 Removes from daily entry list but <strong>preserves all historical data</strong>.</li>" +
            "<li><strong>Reactivate</strong> \u2014 Bring a deactivated device back at any time.</li>" +
            "</ul>" +
            "<div class=\"eikon-help-warn\"><strong>Important:</strong> Always set explicit temperature limits " +
            "for vaccine fridges and critical storage.</div>"
        },
        {
          heading: "Print Report Tab",
          body:
            "<p>Select a From and To date, click Generate, then Print to create a formatted compliance report.</p>"
        },
        {
          heading: "Tips & Best Practices",
          body:
            "<ul>" +
            "<li><strong>Back-date entries</strong> \u2014 Change the date picker to record previous days.</li>" +
            "<li><strong>Batch entry</strong> \u2014 Fill in all devices first, then click Save once.</li>" +
            "<li><strong>Deactivate, don\u2019t delete</strong> \u2014 Preserves history for audits.</li>" +
            "<li><strong>Use Print Dashboard</strong> for a quick visual check of trends.</li>" +
            "<li><strong>Offline support</strong> \u2014 Entries queue locally if offline; click Sync queued when back online.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "cleaning",
      title: "Cleaning",
      icon: "\uD83E\uDDF9",
      subtitle: "Track cleaning staff schedules, times, and work records.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>The Cleaning module records who performed cleaning, when they worked (time in/out), " +
            "and any notes about the work. Entries are stored by month.</p>"
        },
        {
          heading: "Adding an Entry",
          body:
            "<ul>" +
            "<li><strong>Date</strong> \u2014 Defaults to today; can be backdated.</li>" +
            "<li><strong>Time In / Time Out</strong> \u2014 Start and end times (Time Out is optional for incomplete shifts).</li>" +
            "<li><strong>Cleaner Name</strong> \u2014 Who performed the cleaning.</li>" +
            "<li><strong>Staff Name</strong> \u2014 Supervising staff member.</li>" +
            "<li><strong>Notes</strong> \u2014 Optional details about the work done.</li>" +
            "</ul>"
        },
        {
          heading: "Register & Actions",
          body:
            "<p>The register table shows all entries for the selected month. Each row has:</p>" +
            "<ul>" +
            "<li><strong>Edit</strong> \u2014 Opens a modal to modify any field.</li>" +
            "<li><strong>Delete</strong> \u2014 Removes the entry with confirmation.</li>" +
            "</ul>" +
            "<p>Use the <strong>month filter</strong> to navigate between months and <strong>Print</strong> to generate a report.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Use consistent cleaner and staff names for better reporting.</li>" +
            "<li>The Dashboard checks for cleaning entries in the last 14 days \u2014 keep records current to stay green.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "dda-purchases",
      title: "DDA Purchases",
      icon: "\uD83D\uDCE5",
      subtitle: "Record purchases of regulated DDA substances from suppliers.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Tracks purchase records of controlled substances. Records entry dates, DDA names and doses, " +
            "quantities, agent names, and invoice numbers for regulatory compliance.</p>"
        },
        {
          heading: "Adding & Editing Entries",
          body:
            "<ul>" +
            "<li><strong>Entry Date</strong> \u2014 When the purchase occurred (YYYY-MM-DD).</li>" +
            "<li><strong>DDA Name & Dose</strong> \u2014 Full name and dosage (e.g. \"Morphine Sulphate 30mg tablets\").</li>" +
            "<li><strong>Quantity</strong> \u2014 Number of units (must be at least 1).</li>" +
            "<li><strong>Agent</strong> \u2014 Supplier or agent who provided the drugs.</li>" +
            "<li><strong>Invoice Number</strong> \u2014 Reference invoice for the purchase.</li>" +
            "</ul>"
        },
        {
          heading: "Search & Reports",
          body:
            "<p>Use the <strong>search field</strong> to filter by DDA name, agent, or invoice number (live, 250ms debounce). " +
            "The <strong>report section</strong> lets you pick a date range, generate a summary, and print it.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Enter purchases immediately when received for accurate records.</li>" +
            "<li>Use consistent agent names for easier searching.</li>" +
            "<li>Reports can span any date range, independent of the month filter.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "dda-sales",
      title: "DDA Sales",
      icon: "\uD83D\uDCE4",
      subtitle: "Record supply of controlled substances to patients with early-supply detection.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Records sale/supply of controlled substances to patients. Captures comprehensive client info, " +
            "medicine details, doctor details, and prescription information.</p>"
        },
        {
          heading: "Smart Autocomplete",
          body:
            "<p>The form features intelligent suggestions to speed up data entry:</p>" +
            "<ul>" +
            "<li><strong>Client Name & ID Card</strong> \u2014 Auto-suggests from recent entries. A valid ID card auto-populates name and address.</li>" +
            "<li><strong>Medicine</strong> \u2014 Fixed curated list of common DDA medicines. Type and press <span class=\"eikon-help-kbd\">Tab</span> to accept.</li>" +
            "<li><strong>Doctor Name & Reg No.</strong> \u2014 Cross-fill: selecting a doctor auto-fills the reg number and vice versa.</li>" +
            "</ul>"
        },
        {
          heading: "Early Supply Detection",
          body:
            "<p>Rows are highlighted in <strong style=\"color:var(--danger)\">red</strong> if the same client received the same medicine " +
            "within 30 days of a previous sale. This prevents accidental double-dispensing.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>ID Card format is auto-normalised (e.g. \"789M\" becomes \"0000789M\").</li>" +
            "<li>Use the Tab key in the medicine field to quickly accept suggestions.</li>" +
            "<li>Watch for red-highlighted rows \u2014 hover for details on why it\u2019s flagged.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "dda_stocktakes",
      title: "DDA Stock Takes",
      icon: "\uD83D\uDCCB",
      subtitle: "Physical inventory counts of regulated substances.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Manage physical counts of controlled substances. Create stock takes, add items with quantities, " +
            "and mark them as closed when complete.</p>"
        },
        {
          heading: "How It Works",
          body:
            "<ul>" +
            "<li><strong>New Stock Take</strong> \u2014 Creates a new count session with the current timestamp.</li>" +
            "<li><strong>Add Items</strong> \u2014 Enter name, optional dosage, and tablet quantity for each item.</li>" +
            "<li><strong>Inline Editing</strong> \u2014 Click Edit on any row to modify it directly in the table. Press <span class=\"eikon-help-kbd\">Enter</span> to save or <span class=\"eikon-help-kbd\">Esc</span> to cancel.</li>" +
            "<li><strong>Save & Close</strong> \u2014 Marks the stock take as closed (items remain editable for corrections).</li>" +
            "<li><strong>Print</strong> \u2014 Opens a formatted report in a new tab.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Create a new stock take for each count/audit event.</li>" +
            "<li>Stock takes remain editable after closing \u2014 useful for post-count corrections.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "dda-poyc",
      title: "DDA POYC",
      icon: "\uD83C\uDFE5",
      subtitle: "Record POYC supply of controlled substances to patients.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Records point-of-your-care supply of controlled substances. Similar structure to DDA Sales " +
            "with the same smart autocomplete for clients, medicines, and doctors.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Autocomplete</strong> \u2014 Client name, ID card, medicine, doctor name, and reg number all have smart suggestions.</li>" +
            "<li><strong>Cross-fill</strong> \u2014 Selecting a doctor auto-fills the reg number; selecting an ID card auto-fills client details.</li>" +
            "<li><strong>Reports</strong> \u2014 Generate and print reports for any date range.</li>" +
            "<li><strong>Search</strong> \u2014 Filter entries across all fields with live search.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "dailyregister",
      title: "Daily Register",
      icon: "\uD83D\uDCD3",
      subtitle: "Log client medicine supply details for regulatory compliance.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Logs daily client medicine transactions with full prescriber information for regulatory compliance and audit trails.</p>"
        },
        {
          heading: "Fields",
          body:
            "<ul>" +
            "<li><strong>Date</strong> \u2014 Entry date (defaults to today).</li>" +
            "<li><strong>Client Name & Surname</strong> \u2014 Full patient name.</li>" +
            "<li><strong>Client ID</strong> \u2014 ID card number.</li>" +
            "<li><strong>Medicine Name & Dose</strong> \u2014 Full medication description.</li>" +
            "<li><strong>Posology</strong> \u2014 Dosage instructions (e.g. \"1-1-1 x 7 days\").</li>" +
            "<li><strong>Prescriber Name & Reg No</strong> \u2014 Doctor\u2019s name and registration.</li>" +
            "</ul>" +
            "<p>All fields except notes are mandatory. Use the month selector and search to filter entries.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Search is case-insensitive and works across all columns including client ID.</li>" +
            "<li>Print generates a formatted register with row count and timestamp.</li>" +
            "<li>Also available as a quick-entry on the Dashboard.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "certificates",
      title: "Certificates",
      icon: "\uD83D\uDCC4",
      subtitle: "Track compliance certificates, expiry dates, and uploaded documents.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Tracks required certificates and compliance documents (staff certifications, equipment certs, licences). " +
            "Monitor expiry status, upload documents, and generate print-ready reports.</p>"
        },
        {
          heading: "Certificate Cards",
          body:
            "<p>Each certificate displays as a card showing:</p>" +
            "<ul>" +
            "<li><strong>Last Date</strong> \u2014 When the certificate was last obtained.</li>" +
            "<li><strong>Next Due</strong> \u2014 When renewal is required. <strong style=\"color:var(--danger)\">Red</strong> if expired, <strong style=\"color:var(--accent)\">blue</strong> if current.</li>" +
            "<li><strong>EXPIRED badge</strong> \u2014 Appears if the next-due date has passed.</li>" +
            "<li><strong>File info</strong> \u2014 Shows uploaded filename and timestamp.</li>" +
            "</ul>"
        },
        {
          heading: "Actions",
          body:
            "<ul>" +
            "<li><strong>Edit</strong> \u2014 Update last date, renewal interval (1\u2013120 months), and certified person.</li>" +
            "<li><strong>Upload</strong> \u2014 Attach PDF or image. Automatically overwrites previous file.</li>" +
            "<li><strong>Download</strong> \u2014 Retrieve the uploaded document.</li>" +
            "<li><strong>Print All</strong> \u2014 Generates a table of all certificates plus embedded documents.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Set renewal intervals to predict next-due dates automatically.</li>" +
            "<li>The Dashboard flags expired and due-soon certificates \u2014 keep them updated to stay green.</li>" +
            "<li>Print All is ideal for audits \u2014 it includes documents inline.</li>" +
            "</ul>"
        }
      ]
    },

    // ══════════════════════════════════════════════════════════════════════
    // OPERATIONS
    // ══════════════════════════════════════════════════════════════════════

    {
      id: "emergency-pos",
      title: "Emergency POS",
      icon: "\uD83D\uDC8A",
      subtitle: "Offline-first point-of-sale with barcode scanning, camera OCR, and XLSX catalog import.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>A fully offline-capable point-of-sale system. Supports GS1/FMD DataMatrix barcode scanning, " +
            "camera-based product lookup via OCR, XLSX catalog import, and automatic sync when connectivity returns.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>POS</strong></td><td>Cart builder with barcode scanning, product search, and payment processing</td></tr>" +
            "<tr><td><strong>Catalog</strong></td><td>Import XLSX product files, browse and manage your catalog</td></tr>" +
            "<tr><td><strong>History</strong></td><td>View daily sales, reprint receipts, void transactions</td></tr>" +
            "</table>"
        },
        {
          heading: "POS Tab",
          body:
            "<ul>" +
            "<li><strong>Scan Barcode</strong> \u2014 Opens the camera for barcode detection (DataMatrix, QR, EAN-13, Code128, and more).</li>" +
            "<li><strong>Photo Search</strong> \u2014 OCR-based product search from a camera snapshot.</li>" +
            "<li><strong>Manual Entry</strong> \u2014 Add products by name, price, and VAT rate.</li>" +
            "<li><strong>Quantity</strong> \u2014 Supports fractions (e.g. \"1/6\") and decimals.</li>" +
            "<li><strong>Discount</strong> \u2014 0\u201310% per transaction.</li>" +
            "<li><strong>Payment</strong> \u2014 Cash (with change calculation), Card, or Cheque.</li>" +
            "</ul>"
        },
        {
          heading: "Offline & Sync",
          body:
            "<p>Sales completed while offline are <strong>queued locally</strong> and automatically sync " +
            "when your connection returns. A badge shows the number of pending sales.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Import your product catalog via XLSX on the Catalog tab before first use.</li>" +
            "<li>The barcode scanner uses triple-parallel detection for difficult barcodes (normal, inverted, B&W).</li>" +
            "<li>Void a sale from the History tab \u2014 you\u2019ll be asked for a reason.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "endofday",
      title: "End Of Day",
      icon: "\uD83E\uDDFE",
      subtitle: "Daily cash reconciliation with denomination counting, X/Z readings, and BOV deposits.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Daily reconciliation system for cash counting, X/Z readings, payment method tracking " +
            "(cash, cheques, card), and Bank of Valletta deposit management.</p>"
        },
        {
          heading: "Main Entry",
          body:
            "<ul>" +
            "<li><strong>X Reading</strong> \u2014 Opening cash amount. Multiple rows supported.</li>" +
            "<li><strong>Z Reading</strong> \u2014 Closing cash amount. Multiple rows supported.</li>" +
            "<li><strong>Till Counting</strong> \u2014 Enter coin/note counts by denomination (\u20AC5, \u20AC2, \u20AC1, 50c, 20c, 10c, 5c, 2c, 1c).</li>" +
            "<li><strong>Cheques & Card</strong> \u2014 Separate totals for each payment method.</li>" +
            "<li><strong>BOV Deposit</strong> \u2014 Auto-fills from cash notes; editable.</li>" +
            "<li><strong>Float</strong> \u2014 Cash left in till for next day.</li>" +
            "</ul>"
        },
        {
          heading: "Locking & Audit",
          body:
            "<p><strong>Lock</strong> prevents further edits (can be temporarily unlocked). " +
            "An audit tab tracks who changed what and when.</p>"
        },
        {
          heading: "Monthly Summary",
          body:
            "<p>Below the daily entry, a monthly summary shows total cash, over/under amounts, " +
            "and coin box totals for the current month.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>BOV deposit auto-fills from cash notes \u2014 stops auto-filling once you edit it manually.</li>" +
            "<li>Both comma and dot work as decimal separators.</li>" +
            "<li>Lock entries after verification to prevent accidental changes.</li>" +
            "<li>Use Copy Deposit to paste the BOV amount into banking forms.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "shifts",
      title: "Shifts",
      icon: "\uD83D\uDCC5",
      subtitle: "Shift scheduling, leave management, pharmacist coverage, and iCal export.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Comprehensive shift scheduling with annual/sick/urgent family leave tracking, " +
            "pharmacist coverage validation, Malta Employment Law defaults, and iCal export.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Calendar</strong></td><td>Monthly grid with shift count badges and coverage indicators</td></tr>" +
            "<tr><td><strong>Schedule</strong></td><td>Grid view: employees (rows) \u00D7 days (columns)</td></tr>" +
            "<tr><td><strong>Staff</strong></td><td>Staff list with designation, hours, and leave balances</td></tr>" +
            "<tr><td><strong>Leave</strong></td><td>Pending requests, approval/rejection, and leave history</td></tr>" +
            "<tr><td><strong>Integration</strong></td><td>iCal export token for Outlook/Google Calendar</td></tr>" +
            "<tr><td><strong>Settings</strong></td><td>Opening hours, pharmacist requirements, Malta law reference</td></tr>" +
            "</table>"
        },
        {
          heading: "Shift Assignment",
          body:
            "<ul>" +
            "<li>Click a day in the Calendar or Schedule tab to assign shifts.</li>" +
            "<li>Each shift has: staff member, start/end time, role override, and notes.</li>" +
            "<li><strong>Coverage indicator</strong> \u2014 Green = pharmacist coverage OK, Red = gap detected.</li>" +
            "<li><strong>Month Apply</strong> \u2014 Bulk-assign a weekly pattern across the whole month.</li>" +
            "</ul>"
        },
        {
          heading: "Leave Management",
          body:
            "<p>Staff request leave (annual, sick, urgent family) from the Leave tab. " +
            "Managers review pending requests and approve or reject them. " +
            "Leave entitlements are auto-calculated based on contracted hours vs. full-time baseline.</p>"
        },
        {
          heading: "Settings",
          body:
            "<ul>" +
            "<li><strong>Opening hours</strong> \u2014 Per day-of-week defaults, plus date-specific overrides.</li>" +
            "<li><strong>Public holidays</strong> \u2014 Default to CLOSED unless explicitly overridden.</li>" +
            "<li><strong>Malta Employment Law</strong> \u2014 Editable reference for annual leave hours, sick leave, COLA, min wage, etc.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Set up staff and opening hours first, then start scheduling.</li>" +
            "<li>The Dashboard shows pharmacist coverage warnings for the current and next month.</li>" +
            "<li>Use iCal export to sync shifts with Outlook or Google Calendar.</li>" +
            "<li>Locum staff are self-employed \u2014 no leave entitlements apply.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "creditnotes",
      title: "Credit Notes",
      icon: "\uD83D\uDDD2",
      subtitle: "Manage client credit notes, redemptions, balances, and expiry tracking.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Track issued client credits, partial redemptions, and expiry dates. " +
            "Shows open vs. closed notes with live balance calculation.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Open Credit Notes</strong> \u2014 Outstanding credits with remaining balance.</li>" +
            "<li><strong>Closed Credit Notes</strong> \u2014 Fully redeemed or expired.</li>" +
            "<li><strong>Detail Panel</strong> \u2014 Client info, balance (green if available, red if over/expired), payment history, and notes.</li>" +
            "<li><strong>Add Payment</strong> \u2014 Record partial redemption with amount and receipt number.</li>" +
            "<li><strong>Expiry</strong> \u2014 Countdown display; toggle \"Does not expire\" if needed.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Balance auto-recalculates from payment history.</li>" +
            "<li>Search works across client name, phone, and receipt numbers.</li>" +
            "<li>Print generates a statement with signature line.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "paidout",
      title: "Paid Out",
      icon: "\uD83D\uDCB8",
      subtitle: "Track cash and cheque payments to staff, suppliers, and other payees.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Records payments made from the till to staff, suppliers, or other payees. " +
            "Supports cash, cheque, bank transfer, and other payment methods.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Transaction list</strong> \u2014 Date, payee, amount, method, invoice/cheque number.</li>" +
            "<li><strong>Payee autosuggest</strong> \u2014 Uses your contacts database.</li>" +
            "<li><strong>Monthly summary</strong> \u2014 Transaction count, total amount, and breakdown by payment method.</li>" +
            "<li><strong>Reports</strong> \u2014 Generate and print for any date range.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Cheque number field only appears when payment method is Cheque.</li>" +
            "<li>The Dashboard shows today\u2019s total paid-out amount on the Today card.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "locumreceipts",
      title: "Locum Receipts",
      icon: "\uD83E\uDDFE",
      subtitle: "Payment receipts for locum pharmacists with hourly rate calculations.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Track payments to locum pharmacists. Records hours worked, day type " +
            "(normal vs. Sunday/public holiday), hourly rates, and additional charges.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Receipt entry</strong> \u2014 Locum name (with autosuggest), date, hours, day type, hourly rate, additional charges.</li>" +
            "<li><strong>Auto-calculation</strong> \u2014 Total = hours \u00D7 rate + additional charges.</li>" +
            "<li><strong>Malta holidays</strong> \u2014 Public holidays are automatically detected for day-type selection.</li>" +
            "<li><strong>Reports</strong> \u2014 Monthly and yearly summaries (password-protected).</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Hours display as \"2.5\" not \"2.50\" for cleaner formatting.</li>" +
            "<li>Report password is required for printing \u2014 ask your administrator if needed.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "labels",
      title: "Smart Labels",
      icon: "\uD83C\uDFF7",
      subtitle: "Medication dispensing labels with auto-fill, bilingual warnings, and print templates.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Generate pharmacy dispensing labels with auto-fill from a medicine database, " +
            "multi-language support (English/Maltese), customisable templates, and instant printing.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Label Builder</strong></td><td>Create and print labels with auto-fill and warnings</td></tr>" +
            "<tr><td><strong>Templates</strong></td><td>Manage label templates (size, fields, defaults)</td></tr>" +
            "<tr><td><strong>Warnings</strong></td><td>Reference table of standard warnings in English and Maltese</td></tr>" +
            "<tr><td><strong>Pharmacy Settings</strong></td><td>Set pharmacy name, address, phone, licence number</td></tr>" +
            "</table>"
        },
        {
          heading: "Label Builder",
          body:
            "<ul>" +
            "<li><strong>Patient Name</strong> \u2014 Optional; autocomplete from history.</li>" +
            "<li><strong>Medicine Name</strong> \u2014 Autocomplete triggers auto-fill of dose, advice, and warnings.</li>" +
            "<li><strong>Dose, Advice, Warnings</strong> \u2014 Auto-filled from database; all editable. Fields flash green on auto-fill.</li>" +
            "<li><strong>Language toggle</strong> \u2014 Switch between English and Maltese output.</li>" +
            "<li><strong>Print</strong> \u2014 Sends directly to printer via hidden iframe (no popup).</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Auto-fill speeds up entry dramatically \u2014 just start typing the medicine name.</li>" +
            "<li>Reprint from History to re-issue a previously printed label without re-entering data.</li>" +
            "<li>Set up pharmacy details once in the Settings tab; they appear on every label.</li>" +
            "<li>Also available as a quick-entry on the Dashboard.</li>" +
            "</ul>"
        }
      ]
    },

    // ══════════════════════════════════════════════════════════════════════
    // SALES & CLIENTS
    // ══════════════════════════════════════════════════════════════════════

    {
      id: "clientorders",
      title: "Client Orders",
      icon: "\uD83D\uDCE6",
      subtitle: "Manage customer orders from creation through fulfilment with auto-generated order codes.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Track customer orders with auto-generated 6-character order codes, priority levels, " +
            "follow-up status, and fulfilment tracking. Integrates with Order Diary for supply-chain tracking.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Active Orders</strong></td><td>Unfulfilled orders awaiting completion</td></tr>" +
            "<tr><td><strong>Fulfilled Orders</strong></td><td>Completed orders for reference</td></tr>" +
            "</table>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Order Codes</strong> \u2014 Auto-generated 6-character alphanumeric (no ambiguous characters like 0/O, 1/I).</li>" +
            "<li><strong>Priority</strong> \u2014 High (red), Medium (green), Low (blue).</li>" +
            "<li><strong>Follow-up Status</strong> \u2014 Called, Not Wanted, Not Available, Called No Answer, Wrong Number.</li>" +
            "<li><strong>Print Sticker</strong> \u2014 Generates a label with QR code for physical fulfilment tracking.</li>" +
            "<li><strong>Re-order</strong> \u2014 Duplicate a fulfilled order as a template for a new one.</li>" +
            "<li><strong>Order Diary Integration</strong> \u2014 After creating an order, you\u2019re prompted to add items to the Order Diary.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>\"Called (No Answer)\" automatically logs today\u2019s date in notes for follow-up tracking.</li>" +
            "<li>Multi-line items in the Items field become separate entries in the Order Diary.</li>" +
            "<li>Click column headers to sort \u2014 each tab maintains its own sort state.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "quotations",
      title: "Quotations",
      icon: "\uD83D\uDCB0",
      subtitle: "Supplier quotation ledger with cost calculations, VAT handling, and profit margin analysis.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Build detailed quotations with automatic price calculations, profit margin colour-coding, " +
            "VAT handling (0%, 5%, 18%), and duplicate description detection.</p>"
        },
        {
          heading: "Smart Calculations",
          body:
            "<ul>" +
            "<li><strong>VAT cross-calc</strong> \u2014 Edit Cost Excl VAT and Cost Incl VAT auto-updates (and vice versa).</li>" +
            "<li><strong>Discount cross-calc</strong> \u2014 Discount % and Discount \u20AC auto-sync based on which was edited last.</li>" +
            "<li><strong>Profit margin</strong> \u2014 Auto-calculated with colour coding: " +
            "<strong style=\"color:var(--danger)\">Red</strong> &lt;20%, " +
            "<strong style=\"color:#e8b635\">Yellow</strong> 20\u201335%, " +
            "<strong style=\"color:var(--ok)\">Green</strong> \u226535%.</li>" +
            "<li><strong>Similarity detection</strong> \u2014 Warns if a new item description matches an existing one (threshold 60%).</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Enter Cost Excl VAT first \u2014 let the VAT rate auto-calculate the incl value.</li>" +
            "<li>Profit uses pre-VAT cost (since VAT is reclaimed), giving accurate margins.</li>" +
            "<li>Duplicate a quotation with all items to reuse as a template.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "order-diary",
      title: "Order Diary",
      icon: "\uD83D\uDCD6",
      subtitle: "Daily order tracking grouped by supplier with status tracking and carry-over.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Track daily items to order from suppliers. Items are grouped by supplier with status tracking " +
            "(pending, received, not received, wrong pick) and end-of-day carry-over.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Item autocomplete</strong> \u2014 Fuzzy matching from history and quotations (type first few letters).</li>" +
            "<li><strong>Supplier grouping</strong> \u2014 Items grouped visually by supplier with colour-coded headers.</li>" +
            "<li><strong>Status pills</strong> \u2014 \u23F3 Pending, \u2713 Received, \u2717 Not Received, \u26A0 Wrong Pick.</li>" +
            "<li><strong>Carry Over</strong> \u2014 Move all pending/undelivered items to the next day.</li>" +
            "<li><strong>Quotation hints</strong> \u2014 Shows matching cost data from quotations when adding items.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Click the quantity cell (dotted underline) to edit inline.</li>" +
            "<li>\"Mark All Received\" per supplier group saves time on deliveries.</li>" +
            "<li>Use Carry Over at end of day to move outstanding items to tomorrow.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "deliveries",
      title: "Deliveries",
      icon: "\uD83D\uDE9A",
      subtitle: "Track delivery shipments with driver management, address mapping, and delivery logs.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Manage deliveries from scheduling through dispatch, delivery, or failure. " +
            "Supports driver assignment, map-based address entry, tracking numbers, and delivery logs.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Statuses Shown</th></tr>" +
            "<tr><td><strong>Active</strong></td><td>Scheduled, Dispatched, Out for Delivery</td></tr>" +
            "<tr><td><strong>Completed</strong></td><td>Delivered</td></tr>" +
            "<tr><td><strong>Failed</strong></td><td>Failed, Returned, Cancelled</td></tr>" +
            "</table>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Map picker</strong> \u2014 Click to place a pin, drag to fine-tune, with reverse geocoding.</li>" +
            "<li><strong>Delivery log</strong> \u2014 Timestamped notes appended to each delivery (forms an audit trail).</li>" +
            "<li><strong>Driver list</strong> \u2014 Saved locally for quick assignment.</li>" +
            "<li><strong>Reopen</strong> \u2014 Failed deliveries can be moved back to active for re-attempt.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Add log entries immediately when status changes for a clear audit trail.</li>" +
            "<li>Items can flag controlled drugs (\uD83D\uDD10) and cold chain (\u2744\uFE0F) requirements.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "appointments",
      title: "Appointments",
      icon: "\uD83D\uDCC5",
      subtitle: "Medical appointment booking with doctor/clinic schedules, calendar views, and reminders.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Schedule pharmacy consultations and medical check-ups with configurable doctor/clinic availability, " +
            "multiple calendar views, waiting list, and email/WhatsApp integration.</p>"
        },
        {
          heading: "Views",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>View</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Month</strong></td><td>Calendar grid overview</td></tr>" +
            "<tr><td><strong>Week</strong></td><td>Timeline with time slots</td></tr>" +
            "<tr><td><strong>Day</strong></td><td>Hourly grid for current doctor/clinic</td></tr>" +
            "<tr><td><strong>All Appointments</strong></td><td>Searchable list view</td></tr>" +
            "<tr><td><strong>Waiting List</strong></td><td>Patients waiting for openings</td></tr>" +
            "</table>"
        },
        {
          heading: "Setup (Settings Menu)",
          body:
            "<ul>" +
            "<li><strong>Manage Doctors</strong> \u2014 Add/edit doctor profiles.</li>" +
            "<li><strong>Manage Clinics</strong> \u2014 Add/edit clinic locations.</li>" +
            "<li><strong>Manage Schedules</strong> \u2014 Set recurring weekly or one-off availability with slot durations.</li>" +
            "</ul>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Slot availability</strong> \u2014 Auto-checks for conflicts when booking.</li>" +
            "<li><strong>Status flow</strong> \u2014 Scheduled \u2192 Confirmed \u2192 Completed (or Cancelled / No Show).</li>" +
            "<li><strong>Fees</strong> \u2014 Track doctor fee, clinic fee, and medicines cost per appointment.</li>" +
            "<li><strong>Email/WhatsApp</strong> \u2014 Send booking confirmations and reminders.</li>" +
            "<li><strong>Auto-refresh</strong> \u2014 Appointments update every 30 seconds.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Set up doctors, clinics, and schedules first \u2014 then slots auto-generate.</li>" +
            "<li>Doctor colours are assigned automatically (10-colour palette) for easy visual scanning.</li>" +
            "<li>Maltese ID cards are auto-normalised (\"789M\" \u2192 \"0000789M\").</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "tickets",
      title: "Tickets",
      icon: "\uD83C\uDFAB",
      subtitle: "Customer support ticket tracking with priority, assignment, and resolution workflow.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Track customer issues from creation through resolution. Manage priorities, assignments, " +
            "categories, and communication history.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Priority levels</strong> \u2014 Critical (red), High (orange), Medium (yellow), Low (blue).</li>" +
            "<li><strong>Status flow</strong> \u2014 Open \u2192 In Progress \u2192 Resolved \u2192 Closed.</li>" +
            "<li><strong>Assignment</strong> \u2014 Claim tickets or reassign to other staff.</li>" +
            "<li><strong>Communication log</strong> \u2014 Timestamped thread of all messages and actions.</li>" +
            "<li><strong>Time tracking</strong> \u2014 Log hours spent per ticket.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Assign tickets immediately to avoid lost issues.</li>" +
            "<li>Use \"Waiting\" status when awaiting customer response.</li>" +
            "<li>The Dashboard shows open ticket count on the Operations card.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "loyalty",
      title: "Loyalty",
      icon: "\u2B50",
      subtitle: "Multi-campaign loyalty system with stamp cards, points, discounts, events, and tiered rewards.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Run multiple loyalty campaigns simultaneously. Supports 6 campaign types with " +
            "customer registration via Maltese ID card and full transaction ledger.</p>"
        },
        {
          heading: "Campaign Types",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Type</th><th>How It Works</th></tr>" +
            "<tr><td><strong>\u2B50 Stamp Card</strong></td><td>Collect N stamps \u2192 claim free reward</td></tr>" +
            "<tr><td><strong>\uD83D\uDC8E Points</strong></td><td>Earn points per \u20AC spent \u2192 redeem at threshold</td></tr>" +
            "<tr><td><strong>\uD83C\uDFF7 Discount</strong></td><td>Always-on % discount on specific brand/items</td></tr>" +
            "<tr><td><strong>\uD83C\uDF89 Event</strong></td><td>Time-limited campaign (e.g. Black Friday)</td></tr>" +
            "<tr><td><strong>\uD83C\uDF81 Buy X Get Y</strong></td><td>Purchase X items \u2192 receive Y free</td></tr>" +
            "<tr><td><strong>\uD83C\uDFC6 Tiered</strong></td><td>Spend thresholds unlock better rewards</td></tr>" +
            "</table>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Customer registration</strong> \u2014 By Maltese ID card (auto-normalised).</li>" +
            "<li><strong>Transaction ledger</strong> \u2014 Immutable append-only audit trail of all activity.</li>" +
            "<li><strong>Multi-campaign</strong> \u2014 Customers can participate in multiple campaigns at once.</li>" +
            "<li><strong>Progress tracking</strong> \u2014 Visual bars for stamps (\"4/10\") and points (\"850/1000\").</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Stamp cards work best for frequent small-value items; points for variable-spend customers.</li>" +
            "<li>Archive expired campaigns to keep the active list clean.</li>" +
            "<li>Combine Event campaigns with regular ones for layered incentives.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "supplier-inventory",
      title: "Supplier Inventory",
      icon: "\uD83D\uDCE6",
      subtitle: "Browse supplier products, build orders, track deliveries, and analyse profit margins.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Search supplier product catalogues, build purchase orders, track sent orders, " +
            "and mark items as received. Includes profit margin analysis.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Product search</strong> \u2014 Query by barcode, stock code, or description.</li>" +
            "<li><strong>Order workflow</strong> \u2014 Draft \u2192 Sent \u2192 Received (or Cancelled).</li>" +
            "<li><strong>Profit margin colours</strong> \u2014 " +
            "<strong style=\"color:var(--danger)\">Red</strong> \u226420%, " +
            "<strong style=\"color:#e8b635\">Yellow</strong> 20\u201335%, " +
            "<strong style=\"color:var(--ok)\">Green</strong> \u226535%.</li>" +
            "<li><strong>Order Diary integration</strong> \u2014 After marking received, add items to Order Diary.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Review margin colours to identify products needing pricing review or supplier negotiation.</li>" +
            "<li>Draft orders let you prepare without committing \u2014 send when ready.</li>" +
            "<li>Out-of-stock products are still visible but marked.</li>" +
            "</ul>"
        }
      ]
    },

    // ══════════════════════════════════════════════════════════════════════
    // INVENTORY
    // ══════════════════════════════════════════════════════════════════════

    {
      id: "alerts",
      title: "Alerts",
      icon: "\u26A0\uFE0F",
      subtitle: "Manage quarantine and recall alerts with a 7-step checklist workflow.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Track quarantine and recall notifications for pharmacy items. Each alert has a lifecycle " +
            "from open through closure, with a 7-step checklist for tracking actions.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Alert types</strong> \u2014 Recall or Quarantine.</li>" +
            "<li><strong>Status</strong> \u2014 Open, In Progress, or Closed.</li>" +
            "<li><strong>7-step checklist</strong> \u2014 Team informed, Supplier informed, Authorities informed, " +
            "Return arranged, Handed over, Collection note received, Credit note received.</li>" +
            "<li><strong>Side panel</strong> \u2014 Select an alert to update its checklist without opening a modal (auto-saves).</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>The Dashboard flags incomplete alerts showing which checklist items are missing.</li>" +
            "<li>Use the side panel for quick checklist updates \u2014 changes save automatically.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "stocktransfers",
      title: "Stock Transfers",
      icon: "\uD83D\uDD04",
      subtitle: "Transfer stock between pharmacies with a multi-step confirmation workflow.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Transfer items between pharmacies in your organisation. Manages both offering items " +
            "and requesting items with a full confirmation workflow.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Available Items</strong></td><td>Items you\u2019re offering for transfer</td></tr>" +
            "<tr><td><strong>Pending Requests</strong></td><td>Requests received from other pharmacies</td></tr>" +
            "<tr><td><strong>My Requests</strong></td><td>Requests you\u2019ve sent to other pharmacies</td></tr>" +
            "<tr><td><strong>Completed</strong></td><td>Delivered transfers</td></tr>" +
            "</table>"
        },
        {
          heading: "Workflow",
          body:
            "<p>Open \u2192 Requested \u2192 Accepted \u2192 Dispatched \u2192 Delivered</p>" +
            "<ul>" +
            "<li><strong>Place Item</strong> \u2014 Offer an item for other locations to request.</li>" +
            "<li><strong>Accept/Reject</strong> \u2014 Respond to incoming requests.</li>" +
            "<li><strong>Confirm Dispatch</strong> \u2014 Mark item as sent.</li>" +
            "<li><strong>Confirm Delivery</strong> \u2014 Receiving pharmacy confirms receipt.</li>" +
            "</ul>" +
            "<p>Expired items are automatically flagged and cannot be transferred.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>The Dashboard flashes Stock Transfers when you have pending requests or unconfirmed deliveries.</li>" +
            "<li>Items can be auto-placed from Returns or Scarce Stock modules.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "returns",
      title: "Returns",
      icon: "\uD83D\uDD04",
      subtitle: "Manage stock returns to suppliers with a checklist workflow and supplier refusal tracking.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Track returned stock from creation through credit note receipt. Integrates with " +
            "Near Expiry and Stock Transfers modules.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>6-step checklist</strong> \u2014 Return arranged, Handed over, Collection note received, " +
            "Credit note received, Damaged item, Supplier refused.</li>" +
            "<li><strong>Supplier refused</strong> \u2014 When checked, shows as a red badge and disables other workflow steps.</li>" +
            "<li><strong>Remarks autocomplete</strong> \u2014 Common reasons: Wrong Pick, Expiring soon, Damaged, Wrong quantity, etc.</li>" +
            "<li><strong>Copy for Email</strong> \u2014 Formats entry details for pasting into an email.</li>" +
            "<li><strong>Place on Transfer</strong> \u2014 Move item to Stock Transfers for another location.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Returns created from Near Expiry show a \"From Near Expiry\" badge.</li>" +
            "<li>Search filters as you type across all fields.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "nearexpiry",
      title: "Near Expiry",
      icon: "\u23F0",
      subtitle: "Track items approaching expiry with colour-coded urgency and inline actions.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Track items nearing their expiry date. Colour-coded urgency levels, sortable columns, " +
            "and direct integration with Returns and Scarce Stock.</p>"
        },
        {
          heading: "Urgency Colours",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Days</th><th>Colour</th><th>Label</th></tr>" +
            "<tr><td>Expired</td><td><strong style=\"color:var(--danger)\">Red</strong></td><td>\"Expired (Xd)\"</td></tr>" +
            "<tr><td>1\u201330 days</td><td><strong style=\"color:#e8a035\">Orange</strong></td><td>\"X days\"</td></tr>" +
            "<tr><td>31\u201390 days</td><td><strong style=\"color:#e8b635\">Yellow</strong></td><td>\"X days\"</td></tr>" +
            "<tr><td>90+ days</td><td><strong style=\"color:var(--ok)\">Green</strong></td><td>\"X days\"</td></tr>" +
            "</table>"
        },
        {
          heading: "Inline Actions",
          body:
            "<ul>" +
            "<li><strong>Return</strong> \u2014 Create a return entry in the Returns module (enter supplier and quantity).</li>" +
            "<li><strong>Bulk Return</strong> \u2014 Multi-select items with checkboxes for batch return creation.</li>" +
            "<li><strong>Add to Scarce Stock</strong> \u2014 List the item for other locations to request.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Sort by \"Days to Expire\" to see the most urgent items first.</li>" +
            "<li>Bulk Return saves time when returning multiple items to the same supplier.</li>" +
            "<li>These items also appear on the Dashboard with inline action buttons.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "scarcestock",
      title: "Scarce Stock",
      icon: "\uD83D\uDD0D",
      subtitle: "List available stock for other locations and post needs for items you\u2019re looking for.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Two-sided module: offer items you have in excess, and request items you urgently need. " +
            "Visible across all pharmacies in your organisation.</p>"
        },
        {
          heading: "Two Sides",
          body:
            "<ul>" +
            "<li><strong>Available Stock (Offers)</strong> \u2014 Items you\u2019re offering. Set quantity, expiry, batch, and status (Open/Closed).</li>" +
            "<li><strong>Stock Needs</strong> \u2014 Items you need. Set quantity, urgency (Low/Medium/High), and status.</li>" +
            "</ul>"
        },
        {
          heading: "Request Workflow",
          body:
            "<p>Other pharmacies can request your offered items. You accept or reject, then fulfil " +
            "via Stock Transfers. Privacy is maintained \u2014 only the requester and offerer see each other\u2019s details.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Combine with Near Expiry \u2014 add nearly-expired items here before they waste.</li>" +
            "<li>The Dashboard flashes Scarce Stock when you have unaccepted offers.</li>" +
            "</ul>"
        }
      ]
    },

    // ══════════════════════════════════════════════════════════════════════
    // COMMUNICATION
    // ══════════════════════════════════════════════════════════════════════

    {
      id: "messageboard",
      title: "Message Board",
      icon: "\uD83D\uDCAC",
      subtitle: "Organisation-wide messaging with @mentions, pinned messages, and suggestion tracking.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Internal messaging system visible across your organisation. Supports @mention autocomplete, " +
            "#hashtag suggestion extraction, pinned messages, and auto-cleanup after 6 months.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>@mentions</strong> \u2014 Type @ to mention users with autocomplete.</li>" +
            "<li><strong>#suggestions</strong> \u2014 Messages with #hashtags are extracted to a suggestion table.</li>" +
            "<li><strong>Pin messages</strong> \u2014 Pin up to 30 important messages to the top.</li>" +
            "<li><strong>Edit & Delete</strong> \u2014 Modify or remove your messages.</li>" +
            "<li><strong>Suggestion priorities</strong> \u2014 Superadmins can set High/Medium/Low priority and export as CSV.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Unread mentions appear on the Dashboard chat board preview.</li>" +
            "<li>Messages auto-delete after 6 months (server-side cleanup).</li>" +
            "<li>Pin announcements and important guidelines for persistent visibility.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "instructions",
      title: "Instructions",
      icon: "\uD83D\uDCDD",
      subtitle: "Multi-tab instruction management with calendar date selection and severity-coded entries.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Organised instruction management across five categories: Daily, Operations, Systems, Clinical, " +
            "and Settings. Uses a calendar interface for date selection with severity-coded bullet entries.</p>"
        },
        {
          heading: "How It Works",
          body:
            "<ul>" +
            "<li><strong>Calendar view</strong> \u2014 Click dates to select; navigate months with arrows.</li>" +
            "<li><strong>Daily entry</strong> \u2014 Free-text note per day that auto-saves as you type.</li>" +
            "<li><strong>Bullet entries</strong> \u2014 Severity-coded items: " +
            "<strong style=\"color:var(--ok)\">Green</strong> (info), " +
            "<strong style=\"color:#e8b635\">Yellow</strong> (warning), " +
            "<strong style=\"color:var(--danger)\">Red</strong> (critical).</li>" +
            "<li><strong>Press Enter</strong> to quickly add a bullet; edit or delete inline.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Use the Daily tab for handover notes between shifts.</li>" +
            "<li>Severity colours make it easy to scan for critical items.</li>" +
            "<li>The Dashboard shows today\u2019s instructions and yesterday\u2019s handover.</li>" +
            "</ul>"
        }
      ]
    },

    // ══════════════════════════════════════════════════════════════════════
    // CLINICAL
    // ══════════════════════════════════════════════════════════════════════

    {
      id: "poct",
      title: "Point of Care Testing",
      icon: "\uD83E\uDE78",
      subtitle: "Record and track clinical tests: blood pressure, HbA1c, glucose, cholesterol, BMI, and urine.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Comprehensive clinical testing system supporting multiple test types with patient management, " +
            "result tracking, trending charts, and cloud synchronisation.</p>"
        },
        {
          heading: "Test Types",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Test</th><th>Measurements</th></tr>" +
            "<tr><td><strong>Blood Pressure</strong></td><td>Systolic / Diastolic (mmHg)</td></tr>" +
            "<tr><td><strong>HbA1c</strong></td><td>Percentage value</td></tr>" +
            "<tr><td><strong>Blood Glucose</strong></td><td>mg/dL or mmol/L</td></tr>" +
            "<tr><td><strong>Cholesterol</strong></td><td>Total, HDL, LDL (mg/dL)</td></tr>" +
            "<tr><td><strong>Weight/BMI</strong></td><td>Weight (kg), Height (cm) \u2192 BMI auto-calculated</td></tr>" +
            "<tr><td><strong>Urine (Combur 9)</strong></td><td>Multiple parameters from dipstick</td></tr>" +
            "</table>"
        },
        {
          heading: "Tabs",
          body:
            "<ul>" +
            "<li><strong>Records</strong> \u2014 Filterable table of all test records.</li>" +
            "<li><strong>Patients</strong> \u2014 Patient master list with contact details and testing history.</li>" +
            "<li><strong>Analysis & Reports</strong> \u2014 Statistical summaries and patient-specific result trending.</li>" +
            "</ul>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Colour-coded results</strong> \u2014 Normal (green), warning (yellow), critical (red) based on reference ranges.</li>" +
            "<li><strong>Patient ID</strong> \u2014 Maltese format auto-normalised (7 digits + 1 letter).</li>" +
            "<li><strong>Fee tracking</strong> \u2014 Record fee due per test.</li>" +
            "<li><strong>Offline capable</strong> \u2014 Works offline; syncs when connection returns.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Search patients by partial ID or name for quick lookup.</li>" +
            "<li>Reference ranges are built in \u2014 no need to consult external standards.</li>" +
            "<li>Batch-print multiple patient results for documentation.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "vaccines",
      title: "Vaccines",
      icon: "\uD83D\uDC89",
      subtitle: "Travel and routine vaccine management with interactive country map and stock tracking.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Manage travel and routine vaccinations with country-based recommendations, " +
            "stock tracking, order creation, and an interactive puzzle map.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Travel</strong></td><td>Country selector with tiered recommendations (Always Required, High-risk, Optional)</td></tr>" +
            "<tr><td><strong>Routine & Other</strong></td><td>Non-travel routine immunisations</td></tr>" +
            "<tr><td><strong>Stock</strong></td><td>Inventory with batch, expiry, and reorder levels</td></tr>" +
            "<tr><td><strong>Database</strong></td><td>Full vaccine catalogue</td></tr>" +
            "</table>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Click a country on the map for faster selection than typing.</li>" +
            "<li>Quantities sync across recommendations and the table.</li>" +
            "<li>Print as receipt for point-of-sale; print as A4 for documentation.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "ocps",
      title: "OCP Finder",
      icon: "\uD83D\uDC8A",
      subtitle: "Find oral contraceptive pills by hormone type and dose with flexible filtering.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Search for oral contraceptive pills by estrogen and/or progestogen type and dose. " +
            "Supports both monophasic and multiphasic formulations.</p>"
        },
        {
          heading: "How It Works",
          body:
            "<ul>" +
            "<li>Select <strong>estrogen type</strong> and/or <strong>progestogen type</strong> from dropdowns.</li>" +
            "<li>Optionally enter a <strong>dose</strong> with unit toggle (mg/mcg).</li>" +
            "<li>All fields are optional \u2014 leave empty to broaden results.</li>" +
            "<li>Dose matching uses \u00B11% tolerance for rounding.</li>" +
            "<li>Results show trade name, hormone types, and doses. Multiphasic pills are flagged.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Use mcg for micro-dose pills (30 mcg = 0.03 mg).</li>" +
            "<li>Print results for patient counselling or documentation.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "pharmacycalc",
      title: "Pharmacy Calc",
      icon: "\uD83E\uDDEE",
      subtitle: "Dosage calculators for Levothyroxine, Prednisolone, Warfarin, Insulin, and Methotrexate.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Specialised calculators for complex dosage planning. Each supports dose schedules, " +
            "tablet combinations, supply estimation, and printable patient instructions.</p>"
        },
        {
          heading: "Calculators",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>What It Does</th></tr>" +
            "<tr><td><strong>LEV</strong></td><td>Levothyroxine tablet combinations (25/50/75/100 mcg), alternating dose patterns, half/quarter splitting</td></tr>" +
            "<tr><td><strong>PRED</strong></td><td>Prednisolone taper planner with multi-step dose reduction schedules</td></tr>" +
            "<tr><td><strong>WAR</strong></td><td>Warfarin weekly dosing by day with INR instructions and cycle patterns</td></tr>" +
            "<tr><td><strong>INS</strong></td><td>Insulin supply estimator: vials/pens, priming, discard rules, round to boxes</td></tr>" +
            "<tr><td><strong>MTX</strong></td><td>Methotrexate dosing and administration schedules</td></tr>" +
            "</table>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Calculate</strong> \u2014 Shows result table with dates, doses, and tablet combinations.</li>" +
            "<li><strong>Save & Print</strong> \u2014 Store with patient ID and generate printable instructions.</li>" +
            "<li><strong>Records</strong> \u2014 View/edit/delete saved calculations.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Levothyroxine: Use halves/quarters for small dose adjustments.</li>" +
            "<li>Prednisolone: Add taper steps in chronological order.</li>" +
            "<li>Insulin: Enable both priming and discard for realistic supply estimates.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "pharmacovigilance",
      title: "Pharmacovigilance",
      icon: "\u2695\uFE0F",
      subtitle: "Adverse drug reaction reporting compliant with EU/Malta standards.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Capture and submit Individual Case Safety Reports (ICSRs) for adverse drug reactions. " +
            "Compliant with EMA and Malta MPA standards.</p>"
        },
        {
          heading: "5-Step Wizard",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li><strong>Patient Information</strong> \u2014 Initials, sex, age, weight, height, medical history.</li>" +
            "<li><strong>Suspected Drug(s)</strong> \u2014 Name, dose, route, dates, batch, manufacturer (repeatable).</li>" +
            "<li><strong>Reaction / ADR</strong> \u2014 Description, dates, seriousness, outcome, causality, MedDRA term.</li>" +
            "<li><strong>Reporter Information</strong> \u2014 Name, qualification, contact details.</li>" +
            "<li><strong>Review & Submit</strong> \u2014 Summary and status (Draft, Submitted to MPA, Submitted to EMA, Closed).</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Use MedDRA terms for standard reactions \u2014 the autocomplete has 100+ terms.</li>" +
            "<li>Save as Draft first, review, then Submit when confident.</li>" +
            "<li>Include batch numbers for product traceability.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "screening",
      title: "Screening",
      icon: "\uD83C\uDFAF",
      subtitle: "Plan and run health screening campaigns with participant tracking and result analysis.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Manage health screening events (e.g. Diabetes Awareness Week, Blood Pressure Month). " +
            "Integrates with POCT for test recording, tracks participants, and generates reports.</p>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Campaign types</strong> \u2014 Blood Pressure, HbA1c, Glucose, Cholesterol, Weight/BMI, Urine, General, Custom.</li>" +
            "<li><strong>Participant tracking</strong> \u2014 Name, ID, test results, referral status.</li>" +
            "<li><strong>Result categories</strong> \u2014 Normal, Abnormal, Requires urgent attention.</li>" +
            "<li><strong>POCT sync</strong> \u2014 Push screening data to POCT for continuity of care.</li>" +
            "<li><strong>Duplicate campaigns</strong> \u2014 Clone a past campaign to reuse its structure.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Filter by \"Requires urgent attention\" to prioritise interventions.</li>" +
            "<li>Export data for external analysis (CSV/Excel).</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "otcmindmap",
      title: "OTC Mindmap",
      icon: "\uD83E\uDDE0",
      subtitle: "Interactive product knowledge graph showing OTC relationships, symptoms, and guardrails.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Visual, interactive graph of OTC product relationships. Shows connections between products, " +
            "symptoms, use cases, bundles, and safety guardrails on a zoomable canvas.</p>"
        },
        {
          heading: "How It Works",
          body:
            "<ul>" +
            "<li><strong>Search</strong> \u2014 Type a product, symptom, or use case to jump to it on the graph.</li>" +
            "<li><strong>Click nodes</strong> \u2014 Select to load related data in the side panel.</li>" +
            "<li><strong>Side panel sections</strong> \u2014 Symptom links, Similar products, Complementary products, Use cases, Bundles, Guardrails.</li>" +
            "<li><strong>Score threshold</strong> \u2014 Slider to filter weak connections.</li>" +
            "<li><strong>Zoom & pan</strong> \u2014 Use buttons or mouse drag to navigate.</li>" +
            "</ul>"
        },
        {
          heading: "Link Types",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Type</th><th>Colour</th><th>Meaning</th></tr>" +
            "<tr><td>Symptom</td><td>Orange</td><td>Treats this symptom</td></tr>" +
            "<tr><td>Similar</td><td>Blue (dashed)</td><td>Alternative product</td></tr>" +
            "<tr><td>Complements</td><td>Green</td><td>Works well together</td></tr>" +
            "<tr><td>Use Cases</td><td>Purple (dashed)</td><td>Common indication</td></tr>" +
            "<tr><td>Bundles</td><td>Cyan (dashed)</td><td>Multi-product bundle</td></tr>" +
            "<tr><td>Guardrails</td><td>Pink</td><td>Safety warning / interaction</td></tr>" +
            "</table>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Start with a product \u2192 explore what it treats and complements.</li>" +
            "<li>Always check Guardrails before recommending to a patient.</li>" +
            "<li>Hover over nodes to preview before clicking.</li>" +
            "</ul>"
        }
      ]
    },

    // ══════════════════════════════════════════════════════════════════════
    // REFERENCE
    // ══════════════════════════════════════════════════════════════════════

    {
      id: "contacts",
      title: "Contacts",
      icon: "\uD83D\uDCD7",
      subtitle: "Centralised contact management with static references, editable tables, and CSV import/export.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Centralised contact directory combining read-only reference data (emergency numbers, public clinics) " +
            "with editable organisation-wide contact tables.</p>"
        },
        {
          heading: "Sections",
          body:
            "<ul>" +
            "<li><strong>Emergency & Important Numbers</strong> \u2014 Fixed reference (police, ambulance, poison control).</li>" +
            "<li><strong>24/7 Public Health Clinics</strong> \u2014 Static clinic list.</li>" +
            "<li><strong>Suppliers</strong> \u2014 Vendor names, contacts, phone, email, notes.</li>" +
            "<li><strong>Medical Representatives</strong> \u2014 Rep details and company info.</li>" +
            "<li><strong>Head Office</strong> \u2014 Central office contacts.</li>" +
            "<li><strong>Organisation Pharmacies</strong> \u2014 All pharmacy locations in your network.</li>" +
            "<li><strong>POYC</strong> \u2014 Partner pharmacy locations.</li>" +
            "</ul>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>CSV Import/Export</strong> \u2014 Bulk update contacts from spreadsheets or download for backup.</li>" +
            "<li><strong>Shared data</strong> \u2014 All editable tables are shared across your organisation. Changes are visible to all locations immediately.</li>" +
            "<li><strong>Duplicate detection</strong> \u2014 Warns if phone or email already exists.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Keep supplier phone/email updated for quick reordering.</li>" +
            "<li>Use CSV import for bulk updates from external systems.</li>" +
            "<li>Print static sections (emergency numbers) for wall display.</li>" +
            "</ul>"
        }
      ]
    }

  ];

  // Invalidate cache so showHelpGuide rebuilds with new content
  E._helpContentById = null;

})();
