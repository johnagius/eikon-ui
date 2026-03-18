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
    }

  ];

  // Invalidate cache so showHelpGuide rebuilds with new content
  E._helpContentById = null;

})();
