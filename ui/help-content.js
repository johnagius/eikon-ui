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
          heading: "Form Fields",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th><th>Notes</th></tr>" +
            "<tr><td>Date</td><td>Date</td><td>Yes</td><td>Defaults to today</td></tr>" +
            "<tr><td>Client (Name &amp; Surname)</td><td>Text</td><td>Yes</td><td>Max 200 chars</td></tr>" +
            "<tr><td>Address</td><td>Text</td><td>No</td><td>Delivery/contact address</td></tr>" +
            "<tr><td>Contact</td><td>Phone</td><td>Yes</td><td>Primary phone number</td></tr>" +
            "<tr><td>Alternate</td><td>Phone</td><td>No</td><td>Secondary phone</td></tr>" +
            "<tr><td>Email</td><td>Email</td><td>No</td><td></td></tr>" +
            "<tr><td>Item/s</td><td>Textarea</td><td>Yes</td><td>Multi-line; each line becomes a separate Order Diary entry</td></tr>" +
            "<tr><td>Priority</td><td>Dropdown</td><td>Yes</td><td>High (red), Medium (green), Low (blue)</td></tr>" +
            "<tr><td>Needed by</td><td>Date</td><td>Yes</td><td>Required delivery date</td></tr>" +
            "<tr><td>Pick Up Date</td><td>Date</td><td>Yes</td><td>Customer collection date</td></tr>" +
            "<tr><td>Deposit</td><td>Currency (\u20AC)</td><td>No</td><td>Two decimal places</td></tr>" +
            "<tr><td>Follow-up Status</td><td>Dropdown</td><td>No</td><td>Called, Not Wanted, Not Available, Called (No Answer), Wrong Number</td></tr>" +
            "<tr><td>Additional Notes</td><td>Textarea</td><td>No</td><td>Max 2000 chars</td></tr>" +
            "<tr><td>Mark as Fulfilled</td><td>Checkbox</td><td>No</td><td>Completes the order</td></tr>" +
            "</table>"
        },
        {
          heading: "Buttons & Actions",
          body:
            "<ul>" +
            "<li><strong>New Order</strong> \u2014 Opens the order creation modal.</li>" +
            "<li><strong>Edit</strong> \u2014 Modify the selected order.</li>" +
            "<li><strong>Delete</strong> \u2014 Remove order (asks to also remove linked Order Diary items).</li>" +
            "<li><strong>Mark Fulfilled</strong> \u2014 Toggle fulfilment; moves order between Active/Fulfilled tables.</li>" +
            "<li><strong>Print Sticker</strong> \u2014 80mm label with order code, client, items, and QR code.</li>" +
            "<li><strong>Re-order</strong> \u2014 Duplicate a fulfilled order as a new active order.</li>" +
            "<li><strong>Print (per table)</strong> \u2014 Print all active or all fulfilled orders.</li>" +
            "</ul>"
        },
        {
          heading: "Workflows",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Order</strong> and fill in the required fields.</li>" +
            "<li>Click <strong>Save</strong> \u2014 an auto-generated 6-character order code is assigned.</li>" +
            "<li>A prompt asks whether to add items to the <strong>Order Diary</strong> (optional supplier field).</li>" +
            "<li>Track follow-up status as you contact the customer.</li>" +
            "<li>When ready, click <strong>Mark Fulfilled</strong> to move the order to the Fulfilled tab.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>\"Called (No Answer)\" automatically appends today\u2019s date to notes for follow-up tracking.</li>" +
            "<li>Multi-line items become separate Order Diary entries \u2014 one per line.</li>" +
            "<li>Click column headers to sort; each tab maintains its own sort state.</li>" +
            "<li>Deleting an order offers to remove matching items from Order Diary.</li>" +
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
          heading: "Form Fields",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th><th>Notes</th></tr>" +
            "<tr><td>Supplier</td><td>Text</td><td>No</td><td>Supplier company name</td></tr>" +
            "<tr><td>Date</td><td>Date</td><td>Yes</td><td>Defaults to today</td></tr>" +
            "<tr><td>Barcode</td><td>Text</td><td>No</td><td></td></tr>" +
            "<tr><td>Stock Code</td><td>Text</td><td>No</td><td>Internal reference</td></tr>" +
            "<tr><td>Item Description</td><td>Text</td><td>Yes</td><td>Triggers similarity suggestions (&gt;60% match)</td></tr>" +
            "<tr><td>Qty Purchased</td><td>Number</td><td>Yes</td><td>Min 1</td></tr>" +
            "<tr><td>Qty Free</td><td>Number</td><td>No</td><td>Bonus/free items</td></tr>" +
            "<tr><td>VAT Rate</td><td>Dropdown</td><td>Yes</td><td>0%, 5%, or 18%</td></tr>" +
            "<tr><td>Cost Excl. VAT</td><td>Currency</td><td>Cond.</td><td>Auto-syncs with Cost Incl. VAT</td></tr>" +
            "<tr><td>Cost Incl. VAT</td><td>Currency</td><td>Cond.</td><td>Auto-syncs with Cost Excl. VAT</td></tr>" +
            "<tr><td>Discount %</td><td>Number</td><td>No</td><td>Auto-syncs with Discount \u20AC</td></tr>" +
            "<tr><td>Discount \u20AC</td><td>Currency</td><td>No</td><td>Auto-syncs with Discount %</td></tr>" +
            "<tr><td>Total Incl. VAT</td><td>Currency</td><td>Auto</td><td>Editing triggers reverse-calculation</td></tr>" +
            "<tr><td>Retail Price</td><td>Currency</td><td>No</td><td>Selling price per unit</td></tr>" +
            "<tr><td>Profit / Margin %</td><td>Display</td><td>\u2014</td><td>Auto-calculated, colour-coded</td></tr>" +
            "<tr><td>Notes</td><td>Textarea</td><td>No</td><td></td></tr>" +
            "</table>"
        },
        {
          heading: "Smart Calculations",
          body:
            "<ul>" +
            "<li><strong>VAT cross-calc</strong> \u2014 Edit Cost Excl and Cost Incl auto-updates the other.</li>" +
            "<li><strong>Discount cross-calc</strong> \u2014 Discount % and Discount \u20AC auto-sync.</li>" +
            "<li><strong>Total reverse-calc</strong> \u2014 Editing Total Incl VAT derives cost fields automatically.</li>" +
            "<li><strong>Profit margin</strong> \u2014 " +
            "<strong style=\"color:var(--danger)\">Red</strong> &lt;20%, " +
            "<strong style=\"color:#e8b635\">Yellow</strong> 20\u201335%, " +
            "<strong style=\"color:var(--ok)\">Green</strong> \u226535%.</li>" +
            "<li><strong>Similarity detection</strong> \u2014 Warns if a new description matches an existing one (&gt;60%).</li>" +
            "</ul>"
        },
        {
          heading: "Buttons & Actions",
          body:
            "<ul>" +
            "<li><strong>Add Entry</strong> \u2014 New quotation entry.</li>" +
            "<li><strong>Edit / Delete</strong> \u2014 Per-row modification or removal.</li>" +
            "<li><strong>Columns \u25BE</strong> \u2014 Toggle visibility of 17 columns.</li>" +
            "<li><strong>Find Duplicates</strong> \u2014 Scan for similar descriptions and merge variants into a canonical name.</li>" +
            "<li><strong>Print</strong> \u2014 Filtered by date range and supplier, with total invested and total retail summary.</li>" +
            "<li><strong>Delete Selected</strong> \u2014 Bulk delete checked rows.</li>" +
            "<li><strong>My Location</strong> \u2014 Toggle between all organisation data or current location only.</li>" +
            "</ul>"
        },
        {
          heading: "Bulk Import",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Copy the Invoice Extractor GPT link (clipboard button).</li>" +
            "<li>Open ChatGPT, upload a supplier invoice, and copy the TSV output.</li>" +
            "<li>Paste into the Bulk Import textarea and click <strong>Submit</strong>.</li>" +
            "<li>Review the parsed preview table \u2014 edit cells, delete rows, add rows.</li>" +
            "<li>Click <strong>Confirm &amp; Upload</strong> to batch-import all rows.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Enter Cost Excl VAT first \u2014 let the VAT rate auto-calculate Cost Incl.</li>" +
            "<li>Profit uses pre-VAT cost (since VAT is reclaimed), giving accurate margins.</li>" +
            "<li>Use Find Duplicates to standardise item names across suppliers.</li>" +
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
            "(Pending, Received, Not Received, Wrong Pick) and end-of-day carry-over for outstanding items.</p>"
        },
        {
          heading: "Quick-Add Form",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th><th>Notes</th></tr>" +
            "<tr><td>Item name</td><td>Autocomplete</td><td>Yes</td><td>Fuzzy matching from history, quotations, and supplier inventory</td></tr>" +
            "<tr><td>Qty</td><td>Number</td><td>Yes</td><td>Default 1; scroll to adjust</td></tr>" +
            "<tr><td>Supplier</td><td>Autocomplete</td><td>No</td><td>Leave empty for \u201CUnassigned\u201D group</td></tr>" +
            "</table>" +
            "<p>Press <strong>Enter</strong> or click <strong>+ Add</strong> to add immediately.</p>"
        },
        {
          heading: "Status Pills",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Status</th><th>Icon</th><th>Colour</th></tr>" +
            "<tr><td>Pending</td><td>\u23F3</td><td>Grey</td></tr>" +
            "<tr><td>Received</td><td>\u2713</td><td>Green</td></tr>" +
            "<tr><td>Not Received</td><td>\u2717</td><td>Red</td></tr>" +
            "<tr><td>Wrong Pick</td><td>\u26A0</td><td>Orange</td></tr>" +
            "</table>"
        },
        {
          heading: "Buttons & Actions",
          body:
            "<ul>" +
            "<li><strong>Date navigation</strong> \u2014 \u25C0 Previous / \u25B6 Next / Today.</li>" +
            "<li><strong>\u2713 / \u2717 / \u26A0 per row</strong> \u2014 Quick-set status (flashes with colour animation).</li>" +
            "<li><strong>\u2713 All Received (per supplier)</strong> \u2014 Mark all outstanding items in a supplier group as received.</li>" +
            "<li><strong>\uD83D\uDCCB Copy for Email</strong> \u2014 Copies the supplier\u2019s item list for pasting into an email.</li>" +
            "<li><strong>\u21A9 Carry Over</strong> \u2014 Move all pending/not-received/wrong-pick items to the next day.</li>" +
            "<li><strong>Inline qty edit</strong> \u2014 Click the quantity cell (dotted underline) to edit inline.</li>" +
            "<li><strong>Wrong Pick</strong> \u2014 Opens a modal to log a return reason before marking.</li>" +
            "</ul>"
        },
        {
          heading: "Workflows",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Type an item name (autocomplete suggests from history and quotations).</li>" +
            "<li>Set quantity and optionally select a supplier.</li>" +
            "<li>Press Enter or click + Add \u2014 item appears under the supplier group.</li>" +
            "<li>When deliveries arrive, click \u2713 or use \u201C\u2713 All Received\u201D per supplier.</li>" +
            "<li>At end of day, click <strong>Carry Over</strong> to push outstanding items to tomorrow.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Quotation hints appear in the edit modal showing matching cost data.</li>" +
            "<li>Each supplier gets a unique colour (8-colour palette) for quick visual scanning.</li>" +
            "<li>Stat bar at top shows: Total / Received / Pending / Not Received / Wrong Pick.</li>" +
            "<li>Filter tabs let you view items for a single supplier.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "deliveries",
      title: "Deliveries",
      icon: "\uD83D\uDE9A",
      subtitle: "End-to-end delivery tracking with driver management, interactive map, and audit log.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Manage deliveries from scheduling through dispatch, delivery, or failure. " +
            "Supports driver assignment, interactive map-based address entry, tracking numbers, " +
            "delivery attempt counting, and a full audit log per delivery.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Statuses Shown</th></tr>" +
            "<tr><td><strong>Active</strong></td><td>Scheduled, Dispatched, Out for Delivery</td></tr>" +
            "<tr><td><strong>Completed</strong></td><td>Delivered</td></tr>" +
            "<tr><td><strong>Failed / Returned</strong></td><td>Failed, Returned, Cancelled</td></tr>" +
            "</table>"
        },
        {
          heading: "Form Fields",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th><th>Notes</th></tr>" +
            "<tr><td>Order Date</td><td>Date</td><td>Yes</td><td></td></tr>" +
            "<tr><td>Client Name &amp; Surname</td><td>Text</td><td>Yes</td><td></td></tr>" +
            "<tr><td>Phone</td><td>Tel</td><td>Yes</td><td></td></tr>" +
            "<tr><td>Email</td><td>Email</td><td>No</td><td></td></tr>" +
            "<tr><td>Delivery Address</td><td>Textarea</td><td>Yes</td><td>Can also set via map click</td></tr>" +
            "<tr><td>Address Notes</td><td>Text</td><td>No</td><td>Buzzer codes, access instructions</td></tr>" +
            "<tr><td>Delivery Method</td><td>Dropdown</td><td>Yes</td><td>In-house Driver, Courier, Collection</td></tr>" +
            "<tr><td>Priority</td><td>Dropdown</td><td>Yes</td><td>Urgent (same-day), Standard, Flexible</td></tr>" +
            "<tr><td>Scheduled Date / Time Slot</td><td>Date + Text</td><td>No</td><td>e.g. \u201C09:00\u201312:00\u201D</td></tr>" +
            "<tr><td>Driver / Carrier</td><td>Dropdown</td><td>Cond.</td><td>Can add new driver on-the-fly</td></tr>" +
            "<tr><td>Tracking Number</td><td>Text</td><td>No</td><td>For courier shipments</td></tr>" +
            "<tr><td>Flags</td><td>Checkboxes</td><td>No</td><td>\u2744\uFE0F Cold Chain, \u270D Signature Required</td></tr>" +
            "<tr><td>Items</td><td>Inline table</td><td>Yes</td><td>Name, Qty, Schedule, Batch Ref, Expiry per row</td></tr>" +
            "<tr><td>Internal Notes</td><td>Textarea</td><td>No</td><td>Not shown on client label</td></tr>" +
            "</table>"
        },
        {
          heading: "Status Flow & Attempts",
          body:
            "<p><strong>Scheduled</strong> \u2192 <strong>Dispatched</strong> \u2192 <strong>Out for Delivery</strong> \u2192 <strong>Delivered</strong></p>" +
            "<p>If delivery fails, the attempt counter increments. On the <strong>3rd failed attempt</strong>, " +
            "status automatically changes to <strong>Returned</strong>.</p>"
        },
        {
          heading: "Buttons & Actions",
          body:
            "<ul>" +
            "<li><strong>+ New Delivery</strong> \u2014 Open creation modal with interactive map.</li>" +
            "<li><strong>\u2705 Mark Delivered</strong> \u2014 Record actual date, time, recipient name, signature, and proof of delivery.</li>" +
            "<li><strong>\u2717 Mark Failed</strong> \u2014 Log failure reason; auto-increments attempt counter.</li>" +
            "<li><strong>+ Add Log Entry</strong> \u2014 Append a timestamped, author-attributed note to the delivery\u2019s audit trail.</li>" +
            "<li><strong>Edit</strong> \u2014 Modify delivery details; outcome fields appear for dispatched+ statuses.</li>" +
            "<li><strong>Print</strong> \u2014 Print single delivery or entire tab.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Click the map to set the delivery address \u2014 reverse geocoding fills the address field.</li>" +
            "<li>Controlled drug (\uD83D\uDD10) flags are auto-set if items are marked as schedule CD.</li>" +
            "<li>Add log entries immediately when status changes for a clear audit trail.</li>" +
            "<li>Delivery IDs auto-generate (DEL-00001, DEL-00002, etc.).</li>" +
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
            "<p>Before booking, set up these three entities:</p>" +
            "<ul>" +
            "<li><strong>Manage Doctors</strong> \u2014 Name, specialty, phone, default patient fee.</li>" +
            "<li><strong>Manage Clinics</strong> \u2014 Name, locality, address, phone, standard clinic fee.</li>" +
            "<li><strong>Manage Schedules</strong> \u2014 Link a doctor to a clinic with recurring (weekly) or one-off availability, time range, and slot duration (5\u2013120 min).</li>" +
            "</ul>"
        },
        {
          heading: "Booking Form Fields",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th><th>Notes</th></tr>" +
            "<tr><td>Patient Name &amp; Surname</td><td>Text</td><td>Yes</td><td></td></tr>" +
            "<tr><td>ID Card No.</td><td>Text</td><td>Yes</td><td>Auto-normalised (\"789M\" \u2192 \"0000789M\")</td></tr>" +
            "<tr><td>Phone</td><td>Tel</td><td>Yes</td><td></td></tr>" +
            "<tr><td>Email</td><td>Email</td><td>No</td><td></td></tr>" +
            "<tr><td>Doctor</td><td>Dropdown</td><td>Yes</td><td>Cascading: selecting doctor filters clinics</td></tr>" +
            "<tr><td>Clinic</td><td>Dropdown</td><td>Yes</td><td>Auto-populated based on doctor schedules</td></tr>" +
            "<tr><td>Session Date</td><td>Dropdown</td><td>Yes</td><td>Available dates from schedules</td></tr>" +
            "<tr><td>Available Time Slot</td><td>Dropdown</td><td>Yes</td><td>Live availability check prevents double-booking</td></tr>" +
            "<tr><td>Doctor Fee (\u20AC)</td><td>Currency</td><td>No</td><td>Default from clinic config</td></tr>" +
            "<tr><td>Clinic Fee (\u20AC)</td><td>Currency</td><td>No</td><td></td></tr>" +
            "<tr><td>Medicines Cost (\u20AC)</td><td>Currency</td><td>No</td><td></td></tr>" +
            "<tr><td>Medicines / Items</td><td>Textarea</td><td>No</td><td>e.g. \"Amoxicillin 250mg \u00D714\"</td></tr>" +
            "<tr><td>Internal Notes</td><td>Textarea</td><td>No</td><td></td></tr>" +
            "<tr><td>Cancellation Reason</td><td>Text</td><td>Cond.</td><td>Required when status = Cancelled</td></tr>" +
            "</table>"
        },
        {
          heading: "Status Flow",
          body:
            "<p><strong>Scheduled</strong> \u2192 <strong>Confirmed</strong> \u2192 <strong>Completed</strong> (or Cancelled / No Show)</p>"
        },
        {
          heading: "Waiting List",
          body:
            "<p>When no slots are available, add a patient to the waiting list with doctor/clinic preference, " +
            "preferred dates, and flexibility level. Convert to a real appointment when a slot opens.</p>" +
            "<p>Statuses: Waiting \u2192 Offered \u2192 Booked (or Cancelled).</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Set up doctors, clinics, and schedules first \u2014 then slots auto-generate.</li>" +
            "<li>Doctor colours are assigned automatically (10-colour palette) for easy visual scanning.</li>" +
            "<li>Right-click an appointment for Send WhatsApp / Send Email options.</li>" +
            "<li>Fee total (doctor + clinic + medicines) auto-calculates.</li>" +
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
            "categories, and a timestamped notes log per ticket.</p>"
        },
        {
          heading: "Form Fields",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th><th>Notes</th></tr>" +
            "<tr><td>Date Opened</td><td>Date</td><td>Yes</td><td>Defaults to today</td></tr>" +
            "<tr><td>Client Name &amp; Surname</td><td>Text</td><td>Yes</td><td></td></tr>" +
            "<tr><td>Phone</td><td>Tel</td><td>Yes</td><td></td></tr>" +
            "<tr><td>Email</td><td>Email</td><td>No</td><td></td></tr>" +
            "<tr><td>Category</td><td>Dropdown</td><td>Yes</td><td>Billing, Prescription, Product Complaint, Delivery, General Enquiry; add custom</td></tr>" +
            "<tr><td>Priority</td><td>Dropdown</td><td>Yes</td><td>High (red), Medium (orange), Low (green)</td></tr>" +
            "<tr><td>Status</td><td>Dropdown</td><td>Yes</td><td>Open, In Progress, Pending, Resolved, Closed</td></tr>" +
            "<tr><td>Issue Description</td><td>Textarea</td><td>Yes</td><td></td></tr>" +
            "<tr><td>Assigned To</td><td>Dropdown</td><td>Yes</td><td>Staff list; can add new staff inline</td></tr>" +
            "<tr><td>Follow-up Date</td><td>Date</td><td>No</td><td></td></tr>" +
            "</table>"
        },
        {
          heading: "Filtering & Search",
          body:
            "<p>The ticket list can be filtered by <strong>Status</strong>, <strong>Category</strong>, " +
            "<strong>Priority</strong>, and <strong>Assigned To</strong>. The search box searches across " +
            "ticket ID, client, phone, email, category, issue description, and notes.</p>"
        },
        {
          heading: "Notes Log",
          body:
            "<p>Each ticket has a timestamped notes thread. Click <strong>Add Note</strong> to append an entry " +
            "with the current date/time and author. Notes are immutable after creation (you can only add new ones). " +
            "All notes appear in the print view and detail panel.</p>"
        },
        {
          heading: "Workflows",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Create Ticket</strong> \u2014 auto-generates ID (TKT-00001 format).</li>" +
            "<li>Fill client details, category, priority, and description.</li>" +
            "<li>Assign to a staff member.</li>" +
            "<li>As work progresses, add notes and update status.</li>" +
            "<li>Set status to <strong>Resolved</strong> or <strong>Closed</strong> when done.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Custom categories and staff members can be added inline from the dropdown.</li>" +
            "<li>Print view includes full notes log for documentation.</li>" +
            "<li>The Dashboard shows open ticket count.</li>" +
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
            "<tr><th>Type</th><th>How It Works</th><th>Key Settings</th></tr>" +
            "<tr><td><strong>\u2B50 Stamp Card</strong></td><td>Collect N stamps \u2192 free reward</td><td>Stamps required, reward description</td></tr>" +
            "<tr><td><strong>\uD83D\uDC8E Points</strong></td><td>Earn points per \u20AC spent \u2192 redeem at threshold</td><td>Points per \u20AC1, redemption threshold, reward</td></tr>" +
            "<tr><td><strong>\uD83C\uDFF7 Discount</strong></td><td>Always-on % discount on brand/items</td><td>Discount %, scope</td></tr>" +
            "<tr><td><strong>\uD83C\uDF89 Event</strong></td><td>Time-limited campaign</td><td>Event name, offer description</td></tr>" +
            "<tr><td><strong>\uD83C\uDF81 Buy X Get Y</strong></td><td>Purchase X \u2192 Y free</td><td>Buy qty, get qty, free item description</td></tr>" +
            "<tr><td><strong>\uD83C\uDFC6 Tiered</strong></td><td>Spend thresholds unlock rewards</td><td>Up to 4 tiers with min spend + reward</td></tr>" +
            "</table>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Dashboard</strong></td><td>Stats (active campaigns, clients, transactions, today\u2019s activity) + recent activity</td></tr>" +
            "<tr><td><strong>Campaigns</strong></td><td>Campaign grid with create/edit/activate/delete actions</td></tr>" +
            "<tr><td><strong>Record Transaction</strong></td><td>Enter client ID, select campaign, add items, record spend</td></tr>" +
            "<tr><td><strong>Client Search</strong></td><td>Look up a client by ID card to view all transactions and loyalty status</td></tr>" +
            "</table>"
        },
        {
          heading: "Recording a Transaction",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Enter client <strong>ID Card</strong> (autocomplete from history, auto-padded).</li>" +
            "<li>Name auto-fills from known clients.</li>" +
            "<li>Select an <strong>active campaign</strong> from the dropdown.</li>" +
            "<li>Add items: type description (autocomplete), set qty, click <strong>Add Item</strong>.</li>" +
            "<li>Enter <strong>total spend</strong> and optional receipt number.</li>" +
            "<li>Click <strong>Record Transaction</strong>.</li>" +
            "<li>Right panel shows the client\u2019s loyalty snapshot (progress, eligible rewards, history).</li>" +
            "</ol>"
        },
        {
          heading: "Campaign Statuses",
          body:
            "<ul>" +
            "<li><strong>Active</strong> \u2014 Running, accepting transactions.</li>" +
            "<li><strong>Open-ended</strong> \u2014 No expiry date.</li>" +
            "<li><strong>Inactive</strong> \u2014 Paused but not deleted.</li>" +
            "<li><strong>Ended</strong> \u2014 End date has passed.</li>" +
            "<li><strong>Upcoming</strong> \u2014 Start date hasn\u2019t arrived yet.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Stamp cards work best for frequent small-value items; points for variable-spend customers.</li>" +
            "<li>Customers can participate in multiple campaigns at once.</li>" +
            "<li>Transaction ledger is append-only \u2014 provides a full audit trail.</li>" +
            "<li>Combine Event campaigns with regular ones for layered incentives.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "supplier-inventory",
      title: "Supplier Inventory",
      icon: "\uD83D\uDCE6",
      subtitle: "Browse supplier products, build cart orders, track deliveries, and analyse profit margins.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Search supplier product catalogues, build purchase orders by adding to a cart, " +
            "commit orders per supplier, and track order lifecycle from draft to received. " +
            "Includes profit margin analysis and problem reporting.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Inventory</strong></td><td>Browse products, manage cart, commit orders</td></tr>" +
            "<tr><td><strong>My Orders</strong></td><td>View sent orders, track status, report problems</td></tr>" +
            "</table>"
        },
        {
          heading: "Inventory Features",
          body:
            "<ul>" +
            "<li><strong>Search &amp; filter</strong> \u2014 By keyword, barcode, stock code, or supplier.</li>" +
            "<li><strong>Column settings</strong> \u2014 Toggle visibility of columns (Cost, VAT%, Deal, Retail, Margin%, etc.).</li>" +
            "<li><strong>Expiry warnings</strong> \u2014 Configurable red/yellow month thresholds for near-expiry highlighting.</li>" +
            "<li><strong>Deal handling</strong> \u2014 \u201CBuy 3 + 1 Free\u201D or discount % shown; qty input respects deal multiples.</li>" +
            "<li><strong>Profit margin</strong> \u2014 " +
            "<strong style=\"color:var(--ok)\">Green</strong> \u226535%, " +
            "<strong style=\"color:#e8b635\">Yellow</strong> 20\u201335%, " +
            "<strong style=\"color:var(--danger)\">Red</strong> &lt;20%.</li>" +
            "<li><strong>Cart</strong> \u2014 Items grouped by supplier; commit order per supplier with optional notes.</li>" +
            "</ul>"
        },
        {
          heading: "Order Lifecycle",
          body:
            "<p><strong>Draft</strong> (orange) \u2192 <strong>Pending</strong> (blue) \u2192 <strong>Shipped</strong> (blue) \u2192 <strong>Received</strong> (green)</p>" +
            "<p>For shipped/received orders, you can <strong>Report Problem</strong> per item: " +
            "Not Received, Wrong Pick, Damaged, Short Quantity, or Other. " +
            "Supplier responses appear as resolution statuses (Acknowledged, Replacement Sent, Credit Issued, Disputed, Resolved).</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Review margin colours to identify products needing pricing review.</li>" +
            "<li>Cart drafts auto-save periodically and survive page refresh.</li>" +
            "<li>Out-of-stock products are visible but cannot be added to cart.</li>" +
            "<li>After marking an order as received, you can add items to Order Diary.</li>" +
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
            "from open through closure, with a 7-step checklist for tracking actions taken.</p>"
        },
        {
          heading: "Form Fields",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th><th>Notes</th></tr>" +
            "<tr><td>Date</td><td>Date</td><td>Yes</td><td>Defaults to today</td></tr>" +
            "<tr><td>Type</td><td>Dropdown</td><td>Yes</td><td>Recall or Quarantine</td></tr>" +
            "<tr><td>Status</td><td>Dropdown</td><td>Yes</td><td>Open, In Progress, Closed</td></tr>" +
            "<tr><td>Item Name</td><td>Text</td><td>Yes</td><td></td></tr>" +
            "<tr><td>Batch</td><td>Text</td><td>No</td><td>Lot number</td></tr>" +
            "<tr><td>Expiry</td><td>Date</td><td>No</td><td></td></tr>" +
            "<tr><td>Quantity</td><td>Text</td><td>No</td><td>e.g. \"2 boxes / 20 tabs\"</td></tr>" +
            "<tr><td>Room / Fridge</td><td>Dropdown</td><td>Yes</td><td>Storage location</td></tr>" +
            "<tr><td>Supplier</td><td>Text</td><td>No</td><td></td></tr>" +
            "<tr><td>Reason</td><td>Textarea</td><td>No</td><td>Why quarantined/recalled</td></tr>" +
            "<tr><td>Notes</td><td>Textarea</td><td>No</td><td>Additional notes</td></tr>" +
            "</table>"
        },
        {
          heading: "7-Step Checklist",
          body:
            "<p>Select an alert row to open the side panel. Check items off as they\u2019re completed \u2014 " +
            "changes <strong>auto-save</strong> immediately:</p>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Team informed</li>" +
            "<li>Supplier informed</li>" +
            "<li>Authorities informed</li>" +
            "<li>Return arranged</li>" +
            "<li>Handed over</li>" +
            "<li>Collection note received</li>" +
            "<li>Credit note received</li>" +
            "</ol>"
        },
        {
          heading: "Workflows",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Add Alert</strong> and fill in the item details.</li>" +
            "<li>Click a row to select it \u2014 the checklist panel opens on the right.</li>" +
            "<li>Check off each action as it\u2019s completed (auto-saves with timestamp).</li>" +
            "<li>Update status from Open \u2192 In Progress \u2192 Closed as the alert is resolved.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>The Dashboard flags incomplete alerts showing which checklist items are still missing.</li>" +
            "<li>Use the side panel for quick checklist updates without opening a modal.</li>" +
            "<li>Print generates a table of all alerts with their checklist status.</li>" +
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
            "and requesting items, with a full confirmation workflow from placement to delivery.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Available Items</strong></td><td>Items you\u2019re offering; expand rows to see incoming requests</td></tr>" +
            "<tr><td><strong>My Requests</strong></td><td>Requests you\u2019ve sent to other pharmacies</td></tr>" +
            "</table>"
        },
        {
          heading: "Place for Transfer Form",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th></tr>" +
            "<tr><td>Item Description</td><td>Text</td><td>Yes</td></tr>" +
            "<tr><td>Batch</td><td>Text</td><td>No</td></tr>" +
            "<tr><td>Expiry Date</td><td>Date</td><td>No</td></tr>" +
            "<tr><td>Quantity</td><td>Number</td><td>Yes (min 1)</td></tr>" +
            "</table>"
        },
        {
          heading: "Workflow",
          body:
            "<p><strong>Open</strong> \u2192 <strong>Requested</strong> \u2192 <strong>Accepted</strong> \u2192 <strong>Dispatched</strong> \u2192 <strong>Delivered</strong></p>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li><strong>Place Item</strong> \u2014 Offer an item for other locations to request.</li>" +
            "<li>Other pharmacy clicks <strong>Request Transfer</strong> (sets quantity and optional private note).</li>" +
            "<li>You <strong>Accept</strong> or <strong>Reject</strong> the request.</li>" +
            "<li>Click <strong>Confirm Dispatch</strong> when the item is shipped.</li>" +
            "<li>Receiving pharmacy clicks <strong>Confirm Received</strong> to complete.</li>" +
            "</ol>" +
            "<p>Expired items are automatically flagged and cannot be transferred.</p>"
        },
        {
          heading: "Integration Actions",
          body:
            "<ul>" +
            "<li><strong>Place on Returns</strong> \u2014 Move item to the Returns module instead.</li>" +
            "<li><strong>Place on Scarce Stock</strong> \u2014 Move item to the Scarce Stock module.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>The Dashboard flashes Stock Transfers when you have pending requests or unconfirmed deliveries.</li>" +
            "<li>Items can be auto-placed from Returns or Scarce Stock modules.</li>" +
            "<li>Use the \u201COpen only\u201D checkbox to hide closed items.</li>" +
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
          heading: "Form Fields",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th><th>Notes</th></tr>" +
            "<tr><td>Date</td><td>Date</td><td>Yes</td><td>Defaults to today</td></tr>" +
            "<tr><td>Description</td><td>Text</td><td>Yes</td><td>Item name / reason</td></tr>" +
            "<tr><td>Expiry</td><td>Date</td><td>No</td><td></td></tr>" +
            "<tr><td>Batch</td><td>Text</td><td>No</td><td>Lot number</td></tr>" +
            "<tr><td>Quantity</td><td>Text</td><td>No</td><td></td></tr>" +
            "<tr><td>Supplier</td><td>Text</td><td>No</td><td></td></tr>" +
            "<tr><td>Invoice Number</td><td>Text</td><td>No</td><td>For reconciliation</td></tr>" +
            "<tr><td>Remarks</td><td>Text + chips</td><td>No</td><td>Click chip suggestions: Wrong Pick, Expiring soon, Damaged, Wrong quantity, Received late, Duplicate order</td></tr>" +
            "<tr><td>Location Stored</td><td>Text</td><td>No</td><td>e.g. \"Shelves / Back room / Fridge\"</td></tr>" +
            "</table>"
        },
        {
          heading: "Checklist (Auto-save)",
          body:
            "<ul>" +
            "<li>Return arranged</li>" +
            "<li>Handed over</li>" +
            "<li>Collection note received</li>" +
            "<li>Credit note received</li>" +
            "<li>Damaged item</li>" +
            "</ul>" +
            "<p>When <strong>Supplier refused</strong> is marked, a red warning box appears and all checklist items " +
            "(except Damaged) are disabled \u2014 the return is effectively closed.</p>"
        },
        {
          heading: "Buttons & Actions",
          body:
            "<ul>" +
            "<li><strong>Copy for Email</strong> \u2014 Copies formatted return details to clipboard for pasting into an email.</li>" +
            "<li><strong>Place on Transfer</strong> \u2014 Move item to Stock Transfers for another pharmacy.</li>" +
            "<li><strong>Mark as Refused</strong> \u2014 Closes the return when supplier refuses (red badge).</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Returns created from Near Expiry show a \u201CFrom Near Expiry\u201D badge.</li>" +
            "<li>Filtered by month \u2014 use the month selector at the top.</li>" +
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
          heading: "Add Entry Form",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th></tr>" +
            "<tr><td>Product Name</td><td>Text</td><td>Yes</td></tr>" +
            "<tr><td>Expiry Date</td><td>Date</td><td>Yes</td></tr>" +
            "<tr><td>Location</td><td>Text</td><td>No</td></tr>" +
            "<tr><td>Notes</td><td>Text</td><td>No</td></tr>" +
            "</table>"
        },
        {
          heading: "Urgency Colours",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Days</th><th>Colour</th><th>Row Style</th></tr>" +
            "<tr><td>Expired</td><td><strong style=\"color:var(--danger)\">Red</strong></td><td>Red-tinted row</td></tr>" +
            "<tr><td>1\u201330 days</td><td><strong style=\"color:#e8a035\">Orange</strong></td><td>Orange-tinted row</td></tr>" +
            "<tr><td>31\u201390 days</td><td><strong style=\"color:#e8b635\">Yellow</strong></td><td>Yellow-tinted row</td></tr>" +
            "<tr><td>90+ days</td><td><strong style=\"color:var(--ok)\">Green</strong></td><td>Normal row</td></tr>" +
            "</table>"
        },
        {
          heading: "Inline Actions (Per Row)",
          body:
            "<ul>" +
            "<li><strong>Return</strong> \u2014 Opens a modal to create a return (enter supplier and quantity). " +
            "Creates a linked entry in the Returns module. Row shows \u201CReturn pending\u201D or \u201CReturned\u201D pill.</li>" +
            "<li><strong>Add to Scarce Stock</strong> \u2014 Opens a modal to set quantity and batch. " +
            "Lists the item in Scarce Stock for other pharmacies. Row shows \u201CIn Scarce Stock\u201D pill.</li>" +
            "<li><strong>Edit / Delete</strong> \u2014 Modify or remove the entry.</li>" +
            "</ul>"
        },
        {
          heading: "Bulk Return",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Bulk Return</strong> in the toolbar.</li>" +
            "<li>Modal shows all eligible items (those without existing returns) with checkboxes.</li>" +
            "<li>Optionally enter a Supplier and Quantity.</li>" +
            "<li>Use <strong>Select All / Deselect All</strong> buttons to manage selection.</li>" +
            "<li>Click <strong>Create Returns</strong> \u2014 each selected item gets a separate return entry.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Click column headers to sort \u2014 sort by \u201CDays to Expire\u201D for most urgent first.</li>" +
            "<li>Bulk Return saves time when returning multiple items to the same supplier.</li>" +
            "<li>Near-expiry items also appear on the Dashboard with inline action buttons.</li>" +
            "<li>Items where supplier refused the return show a grey \u201CSupplier refused\u201D pill.</li>" +
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
            "<p>Two-sided marketplace: offer items you have in excess, and post needs for items you urgently require. " +
            "Visible across all pharmacies in your organisation. Privacy is maintained \u2014 only involved parties see each other\u2019s details.</p>"
        },
        {
          heading: "Two Views (Toggle)",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>View</th><th>Purpose</th><th>Key Fields</th></tr>" +
            "<tr><td><strong>Available Stock</strong></td><td>Items you\u2019re offering</td><td>Item name, batch, expiry, quantity, status (Open/Closed)</td></tr>" +
            "<tr><td><strong>Stock Needs</strong></td><td>Items you\u2019re looking for</td><td>Item name, needed by date, quantity, status (Open/Closed)</td></tr>" +
            "</table>"
        },
        {
          heading: "Request &amp; Offer Workflow",
          body:
            "<ul>" +
            "<li><strong>Against offers</strong> \u2014 Other pharmacies <em>request</em> your stock. " +
            "You Accept/Reject, then Confirm Dispatch. Receiving pharmacy confirms receipt.</li>" +
            "<li><strong>Against needs</strong> \u2014 Other pharmacies <em>offer</em> stock to you. " +
            "You Accept/Reject the offer.</li>" +
            "</ul>" +
            "<p>Both include a <strong>private note</strong> field visible only to the two parties involved.</p>" +
            "<p>Statuses: Pending \u2192 Accepted \u2192 Dispatched \u2192 Delivered (or Rejected).</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Combine with Near Expiry \u2014 add nearly-expired items here before they go to waste.</li>" +
            "<li>The Dashboard flashes Scarce Stock when you have pending requests.</li>" +
            "<li>Expand a row to see all incoming requests/offers with action buttons.</li>" +
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
          heading: "Scope Toggle",
          body:
            "<p>Switch between <strong>Organisation</strong> (current org only) and <strong>All</strong> " +
            "(all pharmacies across all organisations). When sending to All, a confirmation modal asks you to confirm.</p>"
        },
        {
          heading: "Message Features",
          body:
            "<ul>" +
            "<li><strong>@mentions</strong> \u2014 Type <code>@</code> to trigger autocomplete; shows user name and location.</li>" +
            "<li><strong>#suggestions</strong> \u2014 Messages containing <code>#</code> hashtags are auto-extracted to the Suggestions table.</li>" +
            "<li><strong>Pin messages</strong> \u2014 Pin up to 30 important messages to a collapsible section at the top.</li>" +
            "<li><strong>Edit &amp; Delete</strong> \u2014 Modify or remove your own messages.</li>" +
            "<li><strong>Scope badge</strong> \u2014 Each message shows <strong>ORG</strong> (purple) or <strong>ALL</strong> (blue).</li>" +
            "<li><strong>Load Older</strong> \u2014 Button appears to load previous messages.</li>" +
            "</ul>"
        },
        {
          heading: "Suggestions Table",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Column</th><th>Purpose</th></tr>" +
            "<tr><td>Suggestion</td><td>Title + comment count</td></tr>" +
            "<tr><td>By</td><td>Creator name</td></tr>" +
            "<tr><td>Priority</td><td>Clickable pill: Low / Medium / High</td></tr>" +
            "<tr><td>Status</td><td>Open \u2192 In Progress \u2192 Resolved (superadmin controls)</td></tr>" +
            "<tr><td>Actions</td><td>Edit, Delete, View (superadmin: add comments, change status)</td></tr>" +
            "</table>" +
            "<p>Superadmins can <strong>Export CSV</strong> of all suggestions.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Unread mentions appear on the Dashboard chat board preview.</li>" +
            "<li>Messages auto-delete after 6 months \u2014 pin important ones to keep them permanently.</li>" +
            "<li>Max 2000 characters per message.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "instructions",
      title: "Instructions",
      icon: "\uD83D\uDCDD",
      subtitle: "Multi-tab instruction management with calendar date selection and severity-coded handover bullets.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Organised instruction management across five tabs: Daily &amp; Handover, Opening/Closing, " +
            "Systems, Clinical, and Settings. Uses a calendar interface for date selection.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>\uD83D\uDCC6 Daily &amp; Handover</strong></td><td>Per-day notes, permanent handover instructions, and severity-coded handover bullets</td></tr>" +
            "<tr><td><strong>\uD83D\uDDDD Opening/Closing</strong></td><td>Store opening checklist, closing checklist, end-of-day instructions</td></tr>" +
            "<tr><td><strong>\uD83E\uDDFE Systems</strong></td><td>POS instructions, POYC workflow, ordering process, loyalty schemes</td></tr>" +
            "<tr><td><strong>\uD83E\uDDD1\u200D\u2695\uFE0F Clinical</strong></td><td>HIV/Concerta dispensing (toggleable), doctor appointments, fee schedules</td></tr>" +
            "<tr><td><strong>\u2699\uFE0F Settings</strong></td><td>Storage info and reload controls</td></tr>" +
            "</table>"
        },
        {
          heading: "Daily &amp; Handover Tab",
          body:
            "<ul>" +
            "<li><strong>Calendar</strong> \u2014 Click a date to select. Dots show: " +
            "<strong style=\"color:#5aa2ff\">\u25CF blue</strong> = day notes exist, " +
            "<strong style=\"color:#ffaf32\">\u25CF orange</strong> = outgoing handover bullets, " +
            "<strong style=\"color:#43d17a\">\u25CF green</strong> = incoming handover from previous day.</li>" +
            "<li><strong>Permanent Handover</strong> \u2014 Always-visible instructions shared across all days (rich text editor).</li>" +
            "<li><strong>Day Specific Instructions</strong> \u2014 Notes saved per day. Click Edit to modify.</li>" +
            "<li><strong>Handover From Previous Day</strong> \u2014 Shows bullets entered on the prior day. " +
            "Click \u201CAppend to Day Notes\u201D to merge them into today\u2019s notes.</li>" +
            "<li><strong>Handover Bullets (Outgoing)</strong> \u2014 Severity-coded bullets that carry forward to the next day:</li>" +
            "</ul>" +
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Severity</th><th>Colour</th></tr>" +
            "<tr><td>Low</td><td><strong style=\"color:var(--ok)\">\uD83D\uDFE2 Green</strong></td></tr>" +
            "<tr><td>Medium</td><td><strong style=\"color:#e8b635\">\uD83D\uDFE1 Yellow</strong></td></tr>" +
            "<tr><td>Critical</td><td><strong style=\"color:var(--danger)\">\uD83D\uDD34 Red</strong></td></tr>" +
            "</table>"
        },
        {
          heading: "Other Tabs",
          body:
            "<ul>" +
            "<li><strong>Opening/Closing</strong> \u2014 Three rich-text editors for opening checklist, closing checklist, and end-of-day instructions.</li>" +
            "<li><strong>Systems</strong> \u2014 Four editors: POS, POYC, How to Order Items, Active Loyalty Schemes.</li>" +
            "<li><strong>Clinical</strong> \u2014 Five editors: HIV dispensing (toggleable), Concerta dispensing (toggleable), " +
            "Doctor appointments, Doctor fees, Clinic fees.</li>" +
            "</ul>" +
            "<p>Each editor has Edit/Save/Cancel buttons and shows a \u201CLast updated\u201D timestamp.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Use the Daily tab for shift handover notes \u2014 bullets auto-carry to the next day.</li>" +
            "<li>HIV and Concerta sections can be toggled off to hide them during normal use.</li>" +
            "<li>Click \u201CPrint (A4)\u201D to print all instructions for the selected day.</li>" +
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
            "<p>Comprehensive clinical testing system supporting 6 test types with patient management, " +
            "result tracking, colour-coded reference ranges, and cloud synchronisation.</p>"
        },
        {
          heading: "Sections (Sidebar Navigation)",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Section</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Overview</strong></td><td>Dashboard with recent records and quick-create buttons</td></tr>" +
            "<tr><td><strong>Blood Pressure</strong></td><td>Systolic/Diastolic (mmHg), Pulse, Arm, Position</td></tr>" +
            "<tr><td><strong>HbA1c</strong></td><td>Percentage and mmol/mol values</td></tr>" +
            "<tr><td><strong>Blood Glucose</strong></td><td>mmol/L with timing: Fasting, Random, Post-meal (1h/2h)</td></tr>" +
            "<tr><td><strong>Cholesterol</strong></td><td>Total, HDL, LDL, Triglycerides, TC/HDL Ratio, Fasting status</td></tr>" +
            "<tr><td><strong>Weight / BMI</strong></td><td>Weight (kg), Height (cm), BMI (auto-calculated), Category, Waist (cm)</td></tr>" +
            "<tr><td><strong>Urine (Combur 9)</strong></td><td>Leukocytes, Nitrite, Urobilinogen, Protein, pH, Blood, Ketones, Glucose, Appearance</td></tr>" +
            "<tr><td><strong>All Records</strong></td><td>Searchable archive across all test types</td></tr>" +
            "</table>"
        },
        {
          heading: "Key Features",
          body:
            "<ul>" +
            "<li><strong>Colour-coded results</strong> \u2014 " +
            "<strong style=\"color:var(--ok)\">Green</strong> (normal), " +
            "<strong style=\"color:#e8b635\">Yellow</strong> (warning), " +
            "<strong style=\"color:var(--danger)\">Red</strong> (critical) \u2014 based on built-in reference ranges.</li>" +
            "<li><strong>Patient ID</strong> \u2014 Maltese format auto-normalised (7 digits + 1 letter).</li>" +
            "<li><strong>Fee tracking</strong> \u2014 Record fee due per test.</li>" +
            "<li><strong>BMI auto-calc</strong> \u2014 Enters weight and height, BMI and category auto-fill.</li>" +
            "<li><strong>Offline capable</strong> \u2014 Works offline; syncs when connection returns.</li>" +
            "</ul>"
        },
        {
          heading: "Actions (Per Record)",
          body:
            "<ul>" +
            "<li><strong>View Patient</strong> \u2014 Display patient history across all test types.</li>" +
            "<li><strong>Edit</strong> \u2014 Modify test results.</li>" +
            "<li><strong>Print</strong> \u2014 Printable view with patient metadata and results table.</li>" +
            "<li><strong>Delete</strong> \u2014 Remove record with confirmation.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Search patients by partial ID or name for quick lookup.</li>" +
            "<li>Reference ranges are built in \u2014 no need to consult external standards.</li>" +
            "<li>On first use, a migration modal offers to import data from the previous system.</li>" +
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
            "stock tracking, order creation, and an interactive world map.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>\uD83C\uDF0D Travel</strong></td><td>Select a country (search or click map) to see vaccine recommendations: Always Required (green) and High Risk (yellow). Check vaccines and set quantities.</td></tr>" +
            "<tr><td><strong>\uD83D\uDC89 Routine &amp; Other</strong></td><td>Non-travel routine immunisations. Same checkbox + quantity interface.</td></tr>" +
            "<tr><td><strong>\uD83D\uDCE6 Stock</strong></td><td>Inventory: vaccine name, quantity, batch, expiry. Add/edit/delete stock items.</td></tr>" +
            "<tr><td><strong>\uD83D\uDDC4 Database</strong></td><td>Full vaccine catalogue with brand, manufacturer, and routine/travel classification.</td></tr>" +
            "</table>"
        },
        {
          heading: "Travel Workflow",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Search for a country or click the interactive map.</li>" +
            "<li>Always Required and High Risk vaccines appear with checkboxes.</li>" +
            "<li>Check the vaccines needed and set quantities.</li>" +
            "<li>Fill in client details (name, surname, phone, email).</li>" +
            "<li>Optionally add extra vaccines via the autocomplete field.</li>" +
            "<li>Click <strong>Create Order</strong> \u2014 choose A4 or receipt (75mm) print format.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Click a country on the map for faster selection than typing.</li>" +
            "<li>Quantities sync between the recommendation checkboxes and the order.</li>" +
            "<li>Vaccine tags show \"Routine in Malta\" (green) or not (grey) for quick reference.</li>" +
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
            "<p>Five specialised calculators for complex dosage planning. Each supports dose schedules, " +
            "tablet combinations, supply estimation, and printable patient instructions.</p>"
        },
        {
          heading: "Common Fields (All Calculators)",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th></tr>" +
            "<tr><td>Patient Name</td><td>Text</td><td>Yes</td></tr>" +
            "<tr><td>ID Card</td><td>Text</td><td>No</td></tr>" +
            "<tr><td>Start Date</td><td>Date</td><td>Yes</td></tr>" +
            "<tr><td>Duration (weeks)</td><td>Number</td><td>Yes</td></tr>" +
            "<tr><td>Notes</td><td>Text</td><td>No</td></tr>" +
            "</table>"
        },
        {
          heading: "Calculators",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>What It Does</th><th>Key Settings</th></tr>" +
            "<tr><td><strong>LEV</strong></td><td>Levothyroxine tablet combinations</td><td>Dose 1/2/3 (mcg), pattern mode (Fixed/Alternate/Custom), " +
            "allow splitting (whole/halves/quarters), market box sizes per strength</td></tr>" +
            "<tr><td><strong>PRED</strong></td><td>Prednisolone taper planner</td><td>Drug name, strengths (comma-sep), multi-step dose reduction " +
            "(each step: dose/day, days, note), max tabs/day, round to boxes</td></tr>" +
            "<tr><td><strong>WAR</strong></td><td>Warfarin weekly dosing</td><td>Cycle doses (comma-sep), tablet strengths, pattern mode " +
            "(Fixed/Variable/Custom with per-day inputs), pack specs</td></tr>" +
            "<tr><td><strong>INS</strong></td><td>Insulin supply estimator</td><td>Morning/Afternoon/Evening/Night doses, container type " +
            "(Pen/Vial), units per container, priming units, discard-after days, round to boxes</td></tr>" +
            "<tr><td><strong>MTX</strong></td><td>Methotrexate weekly dosing</td><td>Weekly dose (mg), day of week, tablet strength, " +
            "allow halves, tabs per box, round to boxes</td></tr>" +
            "</table>"
        },
        {
          heading: "Actions",
          body:
            "<ul>" +
            "<li><strong>Calculate</strong> \u2014 Shows result table with dates, doses, and tablet combinations in the right panel.</li>" +
            "<li><strong>Save &amp; Print</strong> \u2014 Store calculation with patient ID and generate A4 printable instructions.</li>" +
            "<li><strong>Clear</strong> \u2014 Reset all fields to defaults.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Levothyroxine: Use halves/quarters for fine dose adjustments between standard strengths.</li>" +
            "<li>Prednisolone: Add taper steps in chronological order; use Reset to Example for a template.</li>" +
            "<li>Insulin: Enable both priming and discard-after for realistic supply estimates.</li>" +
            "<li>Warfarin: Per-day inputs (Mon\u2013Sun) appear in Custom pattern mode.</li>" +
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
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>All Reports</strong></td><td>Searchable list of all ADR reports with Edit, Print, PDF, Delete actions</td></tr>" +
            "<tr><td><strong>New / Edit Report</strong></td><td>5-step wizard form (see below)</td></tr>" +
            "</table>"
        },
        {
          heading: "5-Step Wizard",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li><strong>Patient Information</strong> \u2014 Initials (privacy \u2014 no full names), sex, date of birth, age (auto-calculates year), patient ID, medical history.</li>" +
            "<li><strong>Suspected Drug(s)</strong> \u2014 Repeatable: drug name, dose, route (Oral/IV/IM/SC/Topical/Inhaled/Rectal/Other), " +
            "frequency, start/stop dates, indication, batch number, MAH. Click <strong>+ Add Drug</strong> for multiple drugs.</li>" +
            "<li><strong>Reaction / ADR</strong> \u2014 Free-text description, <strong>MedDRA term</strong> autocomplete (100+ terms), " +
            "start/stop dates, seriousness (Non-serious/Serious/Serious and unexpected), " +
            "outcome (Recovered/Recovering/Not recovered/Fatal/Unknown), " +
            "causality (Certain/Probable/Possible/Unlikely/Unrelated), report type, report status.</li>" +
            "<li><strong>Reporter Information</strong> \u2014 Name, qualification (Pharmacist/Physician/Nurse/Patient/Other), organisation, phone, email.</li>" +
            "<li><strong>Review &amp; Submit</strong> \u2014 Read-only summary of all data with jump-back links to each step for corrections.</li>" +
            "</ol>"
        },
        {
          heading: "Report Statuses",
          body:
            "<ul>" +
            "<li><strong>Preliminary</strong> \u2014 Initial report.</li>" +
            "<li><strong>Periodic / Follow-up</strong> \u2014 Updated information.</li>" +
            "<li><strong>Final</strong> \u2014 Complete report.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Use MedDRA term autocomplete for standard reaction terminology.</li>" +
            "<li>Save as Draft first, review, then Submit when confident.</li>" +
            "<li>Include batch numbers for product traceability.</li>" +
            "<li>Use initials only (not full names) for patient privacy.</li>" +
            "</ul>"
        }
      ]
    },

    {
      id: "screening",
      title: "Screening",
      icon: "\uD83C\uDFAF",
      subtitle: "Plan and run health screening campaigns with participant tracking, follow-ups, and result analysis.",
      sections: [
        {
          heading: "Overview",
          body:
            "<p>Manage health screening events (e.g. Diabetes Awareness Week, Blood Pressure Month). " +
            "Integrates with POCT for test recording, tracks participants, follow-ups, and generates summary reports.</p>"
        },
        {
          heading: "Tabs",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Tab</th><th>Purpose</th></tr>" +
            "<tr><td><strong>Campaigns</strong></td><td>Create/manage campaigns with type, dates, target goal, and participant tracking</td></tr>" +
            "<tr><td><strong>All Participants</strong></td><td>Cross-campaign participant list filterable by result category</td></tr>" +
            "<tr><td><strong>Follow-ups</strong></td><td>Schedule and track follow-up appointments with status (Pending/Scheduled/Completed/No-show/Cancelled/Overdue)</td></tr>" +
            "<tr><td><strong>Summary</strong></td><td>Dashboard with totals, campaign comparison, and progress bars</td></tr>" +
            "</table>"
        },
        {
          heading: "Campaign Types",
          body:
            "<p>Blood Pressure, Diabetes Screening, Cholesterol, Blood Glucose, BMI Assessment, " +
            "Urine Screening, Cardiovascular Risk, Flu Vaccination, Smoking Cessation, General Health Check, Other.</p>"
        },
        {
          heading: "Participant Form Fields",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Field</th><th>Type</th><th>Required</th><th>Notes</th></tr>" +
            "<tr><td>ID Card</td><td>Text</td><td>Yes</td><td>Autocomplete from POCT patients</td></tr>" +
            "<tr><td>Full Name</td><td>Text</td><td>No</td><td>Auto-filled from POCT records</td></tr>" +
            "<tr><td>Phone</td><td>Tel</td><td>No</td><td></td></tr>" +
            "<tr><td>Date of Birth</td><td>Date</td><td>No</td><td></td></tr>" +
            "<tr><td>Type</td><td>Dropdown</td><td>No</td><td>Pre-registered or Walk-in</td></tr>" +
            "<tr><td>Screening Date</td><td>Date</td><td>Yes</td><td></td></tr>" +
            "<tr><td>POCT Results</td><td>Dynamic</td><td>No</td><td>Fields appear based on campaign type (e.g. BP fields for Blood Pressure campaigns)</td></tr>" +
            "<tr><td>Result Notes</td><td>Textarea</td><td>No</td><td></td></tr>" +
            "<tr><td>Result Category</td><td>Dropdown</td><td>Yes</td><td>Normal, Borderline, Abnormal, Requires urgent attention</td></tr>" +
            "<tr><td>Referral</td><td>Dropdown</td><td>Yes</td><td>No referral, GP, Specialist, Hospital, Dietitian, Pharmacist follow-up, Self-monitoring, Other</td></tr>" +
            "</table>"
        },
        {
          heading: "Result Category Colours",
          body:
            "<ul>" +
            "<li><strong style=\"color:var(--ok)\">Green</strong> \u2014 Normal</li>" +
            "<li><strong style=\"color:#e8b635\">Yellow</strong> \u2014 Borderline</li>" +
            "<li><strong style=\"color:#e8a035\">Orange</strong> \u2014 Abnormal</li>" +
            "<li><strong style=\"color:var(--danger)\">Red</strong> \u2014 Requires urgent attention</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>POCT test fields auto-appear based on campaign type \u2014 no manual setup needed.</li>" +
            "<li>Patient data auto-fills from POCT records when you enter an ID card.</li>" +
            "<li>Duplicate a past campaign to reuse its structure for recurring events.</li>" +
            "<li>Follow-ups past their scheduled date are automatically marked <strong>Overdue</strong> (red).</li>" +
            "<li>Summary tab shows progress bars for campaigns with a target goal.</li>" +
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
            "<li><strong>Zoom &amp; pan</strong> \u2014 Use buttons or mouse drag to navigate.</li>" +
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
            "with editable organisation-wide contact tables. Includes global search across all sections.</p>"
        },
        {
          heading: "Static Reference Sections",
          body:
            "<ul>" +
            "<li><strong>Emergency &amp; Important Numbers</strong> \u2014 All Emergencies (112), Ambulance (196), Police (2122 4001), " +
            "Civil Protection (2393 0000), Urgent Non-Emergency (1400), Mater Dei Hospital, Gozo General Hospital.</li>" +
            "<li><strong>24/7 Public Health Clinics</strong> \u2014 Floriana, Mosta, Paola, and the Primary HealthCare Call Centre.</li>" +
            "</ul>"
        },
        {
          heading: "Editable Contact Tables",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Table</th><th>Columns</th><th>Shared</th></tr>" +
            "<tr><td><strong>Client Contacts</strong></td><td>Name, Client ID, Address, Phone, Alternate Phone</td><td>Location-specific</td></tr>" +
            "<tr><td><strong>Suppliers</strong></td><td>Supplier Name, Phone, Email</td><td>Yes</td></tr>" +
            "<tr><td><strong>Medical Representatives</strong></td><td>Rep Name, Phone, Email</td><td>Yes</td></tr>" +
            "<tr><td><strong>Doctors</strong></td><td>Doctor Name, Personal Number, Patient-Safe Number</td><td>Yes</td></tr>" +
            "<tr><td><strong>Specialists</strong></td><td>Name, Specialty (60+ options + filter dropdown), Personal Number, Patient-Safe Number</td><td>Yes</td></tr>" +
            "<tr><td><strong>Locums</strong></td><td>Locum Name, Phone</td><td>Yes</td></tr>" +
            "<tr><td><strong>Head Office</strong></td><td>Office/Department, Phone</td><td>Yes (hideable)</td></tr>" +
            "<tr><td><strong>Organisation Pharmacies</strong></td><td>Pharmacy Name, Phone</td><td>Yes (hideable)</td></tr>" +
            "<tr><td><strong>POYC</strong></td><td>Contact Person/Office, Phone</td><td>Yes</td></tr>" +
            "</table>" +
            "<p><strong>Shared</strong> tables are visible across all locations in your organisation \u2014 " +
            "changes affect everyone. A confirmation modal warns before edits to shared tables.</p>"
        },
        {
          heading: "Actions (Per Table)",
          body:
            "<ul>" +
            "<li><strong>+ Add</strong> \u2014 Add a new row.</li>" +
            "<li><strong>Edit / Del</strong> \u2014 Per-row modification or deletion.</li>" +
            "<li><strong>Export</strong> \u2014 Download as Google Contacts\u2013compatible CSV or copy to clipboard.</li>" +
            "<li><strong>Import</strong> \u2014 Paste CSV text; rows are appended (existing entries kept). " +
            "Shared tables show an extra confirmation before importing.</li>" +
            "<li><strong>Search (per table)</strong> \u2014 Real-time filter with match count.</li>" +
            "<li><strong>Global Search (top)</strong> \u2014 Searches across all tables + emergency numbers + clinics.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Doctors and Specialists have separate <em>Personal</em> and <em>Patient-Safe</em> phone fields.</li>" +
            "<li>Specialists table has a specialty filter dropdown (60+ medical specialties).</li>" +
            "<li>Head Office and Organisation Pharmacies sections can be hidden with a toggle checkbox.</li>" +
            "<li>Print static sections (emergency numbers) for wall display.</li>" +
            "<li>Use CSV import for bulk updates from spreadsheets.</li>" +
            "</ul>"
        }
      ]
    }

  ];

  // Invalidate cache so showHelpGuide rebuilds with new content
  E._helpContentById = null;

})();
