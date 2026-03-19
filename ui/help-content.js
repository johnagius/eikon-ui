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
          heading: "How to Record Daily Temperatures",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Open the <strong>Entries</strong> tab (defaults to today\u2019s date).</li>" +
            "<li>For each device in the table, enter the <strong>Min</strong> and <strong>Max</strong> reading.</li>" +
            "<li>Check the <strong>status dot</strong> next to each row: " +
            "<strong style=\"color:var(--ok)\">Green</strong> = within limits, " +
            "<strong style=\"color:var(--danger)\">Red</strong> = outside limits, " +
            "<strong style=\"color:var(--muted)\">Grey</strong> = not yet entered.</li>" +
            "<li>When all devices are filled in, click <strong>Save</strong>.</li>" +
            "</ol>" +
            "<div class=\"eikon-help-tip\"><strong>Tip:</strong> Fill in all devices first, then click Save once. " +
            "A red dot means the reading is outside limits \u2014 it\u2019s recorded as-is but flagged for review.</div>"
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
          heading: "How to Log a Cleaning Visit",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Entry</strong>.</li>" +
            "<li>Set the <strong>date</strong> (defaults to today) and enter <strong>Time In</strong>.</li>" +
            "<li>Enter the <strong>cleaner name</strong> and your own <strong>staff name</strong> (supervisor).</li>" +
            "<li>Optionally add <strong>notes</strong> about the work done.</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "<li>When the cleaner finishes, find the entry in the register and click <strong>Edit</strong> to add the <strong>Time Out</strong>.</li>" +
            "</ol>"
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
          heading: "How to Record a DDA Purchase",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Entry</strong>.</li>" +
            "<li>Set the <strong>entry date</strong> (when the purchase occurred).</li>" +
            "<li>Enter the <strong>DDA name &amp; dose</strong> (e.g. \"Morphine Sulphate 30mg tablets\").</li>" +
            "<li>Enter the <strong>quantity</strong> received (must be at least 1).</li>" +
            "<li>Enter the <strong>agent</strong> (supplier name) and <strong>invoice number</strong>.</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "</ol>" +
            "<p>Use the <strong>search field</strong> to find past entries by DDA name, agent, or invoice number.</p>"
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
          heading: "How to Record a DDA Sale",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Entry</strong>.</li>" +
            "<li>Enter the <strong>client ID card</strong> \u2014 name and address auto-fill from previous records.</li>" +
            "<li>Start typing the <strong>medicine name</strong> \u2014 select from the curated DDA list (press Tab to accept).</li>" +
            "<li>Enter the <strong>quantity</strong> and <strong>prescription details</strong>.</li>" +
            "<li>Type the <strong>doctor name</strong> \u2014 the registration number auto-fills (or vice versa).</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "<li>If the row highlights <strong style=\"color:var(--danger)\">red</strong>, the same client received this medicine within 30 days \u2014 verify before proceeding.</li>" +
            "</ol>"
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
          heading: "How to Do a Stock Take",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Stock Take</strong> \u2014 a new count session is created with the current timestamp.</li>" +
            "<li>Click <strong>Add Item</strong> and enter the <strong>name</strong>, optional <strong>dosage</strong>, and <strong>tablet quantity</strong>.</li>" +
            "<li>Repeat for each controlled substance in your inventory.</li>" +
            "<li>If you need to correct a count, click <strong>Edit</strong> on the row \u2014 modify inline and press Enter to save (or Esc to cancel).</li>" +
            "<li>When the count is complete, click <strong>Save &amp; Close</strong> to finalise.</li>" +
            "<li>Click <strong>Print</strong> to generate a formatted report for your records.</li>" +
            "</ol>" +
            "<p>Stock takes remain editable after closing \u2014 useful for post-count corrections.</p>"
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
          heading: "How to Record a POYC Supply",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Entry</strong>.</li>" +
            "<li>Enter the <strong>client ID card</strong> \u2014 name and details auto-fill from previous records.</li>" +
            "<li>Start typing the <strong>medicine name</strong> and select from the suggestions.</li>" +
            "<li>Enter the <strong>quantity</strong> and <strong>prescription details</strong>.</li>" +
            "<li>Start typing the <strong>doctor name</strong> or <strong>reg number</strong> \u2014 the other field auto-fills.</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "</ol>" +
            "<p>Use the <strong>search field</strong> to find past entries. Click <strong>Report</strong> to generate a printable summary for any date range.</p>"
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
          heading: "How to Add a Register Entry",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Entry</strong>.</li>" +
            "<li>Enter the <strong>client name &amp; surname</strong> and <strong>client ID</strong> (ID card number).</li>" +
            "<li>Enter the <strong>medicine name &amp; dose</strong> (e.g. \"Amoxicillin 500mg capsules\").</li>" +
            "<li>Enter the <strong>posology</strong> (dosage instructions, e.g. \"1-1-1 x 7 days\").</li>" +
            "<li>Enter the <strong>prescriber name</strong> and <strong>registration number</strong>.</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "</ol>" +
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
          heading: "How to Update a Certificate",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Find the certificate card (e.g. Fire Extinguisher, First Aid, Pharmacy Licence).</li>" +
            "<li>Click <strong>Edit</strong> on the card.</li>" +
            "<li>Set the <strong>last date</strong> (when the certificate was obtained/renewed).</li>" +
            "<li>Set the <strong>renewal interval</strong> (1\u2013120 months) \u2014 the next-due date auto-calculates.</li>" +
            "<li>Enter the <strong>certified person</strong> or responsible party.</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "<li>Click <strong>Upload</strong> to attach the PDF or image of the certificate (overwrites any previous file).</li>" +
            "</ol>" +
            "<p>Cards show <strong style=\"color:var(--danger)\">EXPIRED</strong> in red if the next-due date has passed. " +
            "Click <strong>Download</strong> to retrieve an uploaded document.</p>"
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
          heading: "How to Process a Sale",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Open the <strong>POS</strong> tab.</li>" +
            "<li>Add items to the cart using any method:" +
            "<ul>" +
            "<li><strong>Scan Barcode</strong> \u2014 Click to open the camera and scan (DataMatrix, QR, EAN-13, Code128).</li>" +
            "<li><strong>Photo Search</strong> \u2014 Take a photo and let OCR find the product.</li>" +
            "<li><strong>Manual Entry</strong> \u2014 Type the product name, set the price and VAT rate.</li>" +
            "</ul></li>" +
            "<li>Adjust <strong>quantity</strong> for each item (supports fractions like \"1/6\" and decimals).</li>" +
            "<li>Optionally apply a <strong>discount</strong> (0\u201310%).</li>" +
            "<li>Click <strong>Pay</strong> and select the payment method: Cash (enter amount tendered \u2014 change auto-calculates), Card, or Cheque.</li>" +
            "<li>Click <strong>Complete Sale</strong> \u2014 the receipt prints and the transaction appears in History.</li>" +
            "</ol>"
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
            "<p>Daily cash reconciliation to close out the till. Compare the physical cash count against " +
            "expected deposits, track all payment methods, prepare the BOV bank deposit, and lock the " +
            "record when everything balances.</p>"
        },
        {
          heading: "How to Complete an End of Day",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li><strong>Set the header</strong> \u2014 Select AM or PM, enter your <strong>Staff Name</strong> (required), " +
            "and confirm the <strong>Float</strong> amount (default \u20AC1,000).</li>" +
            "<li><strong>Enter payment readings</strong> \u2014 Fill in each section below:</li>" +
            "</ol>" +
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Section</th><th>What to Enter</th><th>Notes</th></tr>" +
            "<tr><td><strong>X Readings</strong></td><td>POS system reading amounts</td><td>Click \u201CAdd Entry\u201D for multiple tills; each row has amount + remark</td></tr>" +
            "<tr><td><strong>EPOS</strong></td><td>Electronic card payment totals</td><td>One row per terminal or card type</td></tr>" +
            "<tr><td><strong>Cheques</strong></td><td>Cheque payment totals</td><td>Record each cheque as a separate row</td></tr>" +
            "<tr><td><strong>Paid Outs</strong></td><td>Cash paid out of the till during the day</td><td>Petty cash, supplier COD payments, etc.</td></tr>" +
            "</table>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\" start=\"3\">" +
            "<li><strong>Count the cash</strong> \u2014 In the <strong>Cash Count</strong> section, enter how many of each note denomination " +
            "(\u20AC500, \u20AC200, \u20AC100, \u20AC50, \u20AC20, \u20AC10, \u20AC5) you physically count in the till, plus the total Coins value. " +
            "The <strong>Total Cash Till</strong> auto-calculates.</li>" +
            "<li><strong>Review the summary</strong> \u2014 Check the auto-calculated values:</li>" +
            "</ol>" +
            "<ul>" +
            "<li><strong>Expected Deposit</strong> = X Readings \u2212 EPOS \u2212 Cheques \u2212 Paid Outs</li>" +
            "<li><strong>Cash (E)</strong> = Total Cash Till \u2212 Float</li>" +
            "<li><strong>Over / Under</strong> = Cash (E) \u2212 Expected Deposit</li>" +
            "<li><strong>Coins</strong> = Cash (E) \u2212 Rounded Cash Deposited</li>" +
            "</ul>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\" start=\"5\">" +
            "<li><strong>Prepare the BOV deposit</strong> \u2014 The deposit denomination table auto-fills from your cash count " +
            "(largest notes first). Enter the <strong>Bag Number</strong> (required when depositing). " +
            "Optionally select a contact and click <strong>Copy Deposit to Email</strong> to paste into Outlook.</li>" +
            "<li><strong>Save</strong> \u2014 Click <strong>Save</strong> to persist the record locally and to the cloud.</li>" +
            "<li><strong>Lock</strong> \u2014 Once you\u2019re satisfied everything is correct, click <strong>Lock</strong>. " +
            "This disables all fields to prevent accidental changes. You can <strong>Unlock</strong> later if corrections are needed.</li>" +
            "</ol>"
        },
        {
          heading: "Buttons",
          body:
            "<table class=\"eikon-help-table\">" +
            "<tr><th>Button</th><th>When Available</th><th>What It Does</th></tr>" +
            "<tr><td><strong>Save</strong></td><td>When unlocked</td><td>Persists the record (local + cloud) and logs the action</td></tr>" +
            "<tr><td><strong>Lock</strong></td><td>When unlocked</td><td>Validates required fields, then freezes all inputs</td></tr>" +
            "<tr><td><strong>Unlock</strong></td><td>When locked</td><td>Confirmation modal, then re-enables editing</td></tr>" +
            "<tr><td><strong>Print End of Day on A4</strong></td><td>Always</td><td>Prints the current day\u2019s sheet</td></tr>" +
            "<tr><td><strong>Report (Date Range)</strong></td><td>Always</td><td>Select a date range and print a multi-day summary</td></tr>" +
            "<tr><td><strong>Audit Log</strong></td><td>Always</td><td>View timestamped history of all actions (Save, Lock, Unlock, Print)</td></tr>" +
            "<tr><td><strong>Copy Deposit to Email</strong></td><td>In BOV section</td><td>Copies formatted deposit table to clipboard for Outlook</td></tr>" +
            "<tr><td><strong>Manage Contacts</strong></td><td>In BOV section</td><td>Add/edit/delete email recipients for deposit notifications</td></tr>" +
            "</table>"
        },
        {
          heading: "Monthly Summary",
          body:
            "<p>Below the daily entry, a running monthly summary updates live as you type:</p>" +
            "<ul>" +
            "<li><strong>Total Cash (Month)</strong> \u2014 Sum of all daily cash values this month.</li>" +
            "<li><strong>Over/Under (Month)</strong> \u2014 Cumulative discrepancy for the month.</li>" +
            "<li><strong>Coin Box (Month)</strong> \u2014 Total coins set aside for the month.</li>" +
            "</ul>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>BOV deposit auto-fills from your cash count using largest notes first \u2014 it stops auto-filling once you manually edit any deposit field.</li>" +
            "<li>Both comma and dot work as decimal separators (EU keyboard support).</li>" +
            "<li>Always <strong>Lock</strong> after verification \u2014 this creates an audit trail and prevents accidental changes.</li>" +
            "<li>The Audit Log records every Save, Lock, Unlock, and Print action with who did it and when.</li>" +
            "<li>If the cloud is unavailable, your data is saved locally and syncs when the connection returns.</li>" +
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
          heading: "Getting Started (First-Time Setup)",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Go to the <strong>Settings</strong> tab and set your <strong>opening hours</strong> for each day of the week.</li>" +
            "<li>Add any date-specific overrides (e.g. Christmas hours, summer schedule).</li>" +
            "<li>Go to the <strong>Staff</strong> tab and add your employees \u2014 set designation (Pharmacist, Technician, etc.), contracted hours, and start date.</li>" +
            "<li>Now you\u2019re ready to start scheduling shifts.</li>" +
            "</ol>"
        },
        {
          heading: "How to Schedule a Shift",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Open the <strong>Calendar</strong> or <strong>Schedule</strong> tab.</li>" +
            "<li>Click on a day \u2014 the shift assignment panel opens.</li>" +
            "<li>Select a <strong>staff member</strong>, set the <strong>start/end time</strong>, and optionally add a role override or notes.</li>" +
            "<li>Click <strong>Save</strong> \u2014 the day now shows a shift count badge.</li>" +
            "<li>Repeat for each staff member working that day.</li>" +
            "</ol>" +
            "<p><strong>Quick fill:</strong> Use <strong>Month Apply</strong> to apply a weekly pattern " +
            "(e.g. Mon\u2013Fri 09:00\u201317:30) across the entire month in one click.</p>"
        },
        {
          heading: "How to Handle Leave Requests",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Go to the <strong>Leave</strong> tab to see pending requests.</li>" +
            "<li>Review the request dates and check the calendar for coverage impact.</li>" +
            "<li>Click <strong>Approve</strong> or <strong>Reject</strong> \u2014 the staff member\u2019s leave balance updates automatically.</li>" +
            "</ol>" +
            "<p>Leave types: Annual, Sick, Urgent Family. Entitlements auto-calculate based on contracted hours vs. full-time baseline.</p>"
        },
        {
          heading: "Coverage Indicator",
          body:
            "<p>Each day shows a coverage indicator: " +
            "<strong style=\"color:var(--ok)\">Green</strong> = pharmacist coverage OK, " +
            "<strong style=\"color:var(--danger)\">Red</strong> = gap detected. " +
            "The Dashboard also warns about coverage gaps for the current and next month.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Use iCal export (Integration tab) to sync shifts with Outlook or Google Calendar.</li>" +
            "<li>Locum staff are self-employed \u2014 no leave entitlements apply.</li>" +
            "<li>Public holidays default to CLOSED unless you add an override in Settings.</li>" +
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
          heading: "How to Issue a Credit Note",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Credit Note</strong>.</li>" +
            "<li>Enter the <strong>client name</strong>, <strong>phone</strong>, and the <strong>credit amount</strong>.</li>" +
            "<li>Set an <strong>expiry date</strong> (or tick \u201CDoes not expire\u201D).</li>" +
            "<li>Optionally add a <strong>receipt number</strong> and <strong>notes</strong> (e.g. reason for credit).</li>" +
            "<li>Click <strong>Save</strong> \u2014 the credit note appears in the Open list with a green balance.</li>" +
            "</ol>"
        },
        {
          heading: "How to Redeem (Record a Payment)",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Find the credit note in the Open list (search by client name, phone, or receipt number).</li>" +
            "<li>Click the row to open the <strong>detail panel</strong>.</li>" +
            "<li>Click <strong>Add Payment</strong>.</li>" +
            "<li>Enter the <strong>amount redeemed</strong> and the <strong>receipt number</strong>.</li>" +
            "<li>Click <strong>Save</strong> \u2014 the remaining balance updates immediately.</li>" +
            "<li>When the balance reaches \u20AC0.00, the note automatically moves to the Closed list.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Balance auto-recalculates from the full payment history \u2014 partial redemptions are supported.</li>" +
            "<li>Expired notes turn red and move to Closed automatically.</li>" +
            "<li>Print generates a statement with signature line for the client.</li>" +
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
          heading: "How to Record a Paid Out",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Paid Out</strong>.</li>" +
            "<li>Start typing the <strong>payee name</strong> \u2014 autosuggest offers matches from your contacts.</li>" +
            "<li>Enter the <strong>amount</strong> and select the <strong>payment method</strong> (Cash, Cheque, Bank Transfer, Other).</li>" +
            "<li>If Cheque is selected, a <strong>cheque number</strong> field appears \u2014 fill it in.</li>" +
            "<li>Optionally add an <strong>invoice number</strong> and <strong>notes</strong>.</li>" +
            "<li>Click <strong>Save</strong> \u2014 the transaction appears in today\u2019s list and the daily total updates.</li>" +
            "</ol>" +
            "<p>These totals feed into the <strong>End of Day</strong> Paid Outs section automatically.</p>"
        },
        {
          heading: "Generating a Report",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Report</strong>.</li>" +
            "<li>Select a <strong>date range</strong> (from/to).</li>" +
            "<li>The report shows transaction count, total amount, and breakdown by payment method.</li>" +
            "<li>Click <strong>Print</strong> to produce a printable version.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>The Dashboard shows today\u2019s total paid-out amount on the Today card.</li>" +
            "<li>Monthly summary at the bottom tracks totals for the current month.</li>" +
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
          heading: "How to Create a Receipt",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Receipt</strong>.</li>" +
            "<li>Start typing the <strong>locum name</strong> \u2014 autosuggest offers previous locums.</li>" +
            "<li>Select the <strong>date</strong>. Public holidays and Sundays are auto-detected and adjust the day type.</li>" +
            "<li>Enter <strong>hours worked</strong> and the <strong>hourly rate</strong>.</li>" +
            "<li>Optionally add <strong>additional charges</strong> (e.g. travel allowance).</li>" +
            "<li>The <strong>total</strong> auto-calculates: hours \u00D7 rate + additional charges.</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "</ol>"
        },
        {
          heading: "How to Generate Reports",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Report</strong> and select <strong>Monthly</strong> or <strong>Yearly</strong>.</li>" +
            "<li>Enter the <strong>report password</strong> (ask your administrator if you don\u2019t have it).</li>" +
            "<li>The summary shows total hours, total paid, and breakdown per locum.</li>" +
            "<li>Click <strong>Print</strong> to produce a printable version.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Hours display as \"2.5\" not \"2.50\" for cleaner formatting.</li>" +
            "<li>Sunday and public holiday rates can differ from normal-day rates \u2014 adjust per receipt.</li>" +
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
          heading: "First-Time Setup",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Go to <strong>Pharmacy Settings</strong> and enter your pharmacy name, address, phone, and licence number \u2014 these appear on every label.</li>" +
            "<li>Go to <strong>Templates</strong> to review the default label sizes. Create custom templates if needed.</li>" +
            "<li>You\u2019re now ready to print labels from the Label Builder.</li>" +
            "</ol>"
        },
        {
          heading: "How to Print a Label",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Open the <strong>Label Builder</strong> tab.</li>" +
            "<li>Optionally type the <strong>patient name</strong> (autocomplete from history).</li>" +
            "<li>Start typing the <strong>medicine name</strong> \u2014 select from autocomplete.</li>" +
            "<li>The <strong>dose</strong>, <strong>advice</strong>, and <strong>warnings</strong> auto-fill from the database (fields flash green). Edit any field if needed.</li>" +
            "<li>Toggle the <strong>language</strong> (English or Maltese) if required.</li>" +
            "<li>Click <strong>Print</strong> \u2014 the label sends directly to the printer, no popup.</li>" +
            "</ol>" +
            "<p>To reprint a previous label, open <strong>History</strong> and click <strong>Reprint</strong> on any past entry.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Auto-fill speeds up entry dramatically \u2014 just start typing the medicine name.</li>" +
            "<li>The <strong>Warnings</strong> tab is a reference table of all standard warnings in English and Maltese.</li>" +
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
            "follow-up status, and fulfilment tracking. Integrates with Order Diary for supply-chain tracking.</p>" +
            "<p>The <strong>Active Orders</strong> tab shows unfulfilled orders; the <strong>Fulfilled Orders</strong> tab shows completed ones.</p>"
        },
        {
          heading: "How to Create and Fulfil an Order",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Order</strong>.</li>" +
            "<li>Enter the client\u2019s <strong>name</strong>, <strong>phone</strong>, and <strong>email</strong>.</li>" +
            "<li>In the <strong>Items</strong> field, type each item on a separate line (each line becomes a separate Order Diary entry later).</li>" +
            "<li>Set the <strong>priority</strong> (High/Medium/Low), <strong>needed by</strong> date, and <strong>pick-up date</strong>.</li>" +
            "<li>Click <strong>Save</strong> \u2014 a 6-character order code is auto-generated.</li>" +
            "<li>A prompt asks whether to add the items to the <strong>Order Diary</strong> \u2014 click Yes to track them with your supplier orders.</li>" +
            "<li>As you follow up with the client, update the <strong>follow-up status</strong>: Called, Not Wanted, Not Available, Called (No Answer), or Wrong Number.</li>" +
            "<li>When the order is ready for collection, click <strong>Mark Fulfilled</strong> \u2014 it moves to the Fulfilled tab.</li>" +
            "<li>Click <strong>Print Sticker</strong> to generate an 80mm label with QR code for the bag.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>\"Called (No Answer)\" automatically appends today\u2019s date to notes for follow-up tracking.</li>" +
            "<li>Multi-line items become separate Order Diary entries \u2014 one per line.</li>" +
            "<li>Use <strong>Re-order</strong> on a fulfilled order to duplicate it as a new active order.</li>" +
            "<li>Deleting an order offers to remove matching items from Order Diary too.</li>" +
            "<li>Click column headers to sort; each tab maintains its own sort state.</li>" +
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
          heading: "How to Add a Quotation Entry",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Add Entry</strong>.</li>" +
            "<li>Enter the <strong>Supplier</strong> name and <strong>Item Description</strong>. If the description is similar to an existing entry, you\u2019ll see a warning.</li>" +
            "<li>Set the <strong>Qty Purchased</strong>, any <strong>Qty Free</strong> (bonus items), and the <strong>VAT Rate</strong> (0%, 5%, or 18%).</li>" +
            "<li>Enter the <strong>Cost Excl. VAT</strong> \u2014 Cost Incl. VAT fills automatically (or enter Cost Incl. and it works in reverse).</li>" +
            "<li>If there\u2019s a discount, enter either <strong>Discount %</strong> or <strong>Discount \u20AC</strong> \u2014 the other syncs automatically.</li>" +
            "<li>Enter the <strong>Retail Price</strong> (your selling price) to see the profit margin appear in the row, colour-coded: " +
            "<strong style=\"color:var(--danger)\">Red</strong> &lt;20%, " +
            "<strong style=\"color:#e8b635\">Yellow</strong> 20\u201335%, " +
            "<strong style=\"color:var(--ok)\">Green</strong> \u226535%.</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "</ol>"
        },
        {
          heading: "How to Bulk Import from an Invoice",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Bulk Import</strong> and copy the Invoice Extractor GPT link (clipboard button).</li>" +
            "<li>Open ChatGPT, upload a supplier invoice, and copy the TSV output.</li>" +
            "<li>Paste into the Bulk Import textarea and click <strong>Submit</strong>.</li>" +
            "<li>Review the parsed preview table \u2014 edit cells, delete rows, add rows as needed.</li>" +
            "<li>Click <strong>Confirm &amp; Upload</strong> to batch-import all rows.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Enter Cost Excl VAT first \u2014 let the VAT rate auto-calculate Cost Incl.</li>" +
            "<li>Profit uses pre-VAT cost (since VAT is reclaimed), giving accurate margins.</li>" +
            "<li>Use <strong>Find Duplicates</strong> to standardise item names across suppliers.</li>" +
            "<li>Use <strong>Columns \u25BE</strong> to show/hide columns \u2014 e.g. hide Barcode and Stock Code if you don\u2019t use them.</li>" +
            "<li>Toggle <strong>My Location</strong> to see just your location\u2019s data or the whole organisation.</li>" +
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
            "<p>Track daily items to order from suppliers. Items are grouped by supplier with colour-coded headers " +
            "and status tracking (Pending, Received, Not Received, Wrong Pick).</p>"
        },
        {
          heading: "How to Use the Order Diary Each Day",
          body:
            "<p><strong>Morning \u2014 add items to order:</strong></p>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Start typing an <strong>item name</strong> \u2014 autocomplete suggests from history and quotations.</li>" +
            "<li>Set the <strong>quantity</strong> and optionally select a <strong>supplier</strong> (leave empty for \u201CUnassigned\u201D).</li>" +
            "<li>Press <strong>Enter</strong> or click <strong>+ Add</strong> \u2014 the item appears under its supplier group.</li>" +
            "<li>Repeat for all items. Use <strong>Copy for Email</strong> on a supplier group to paste the list into an email to that supplier.</li>" +
            "</ol>" +
            "<p><strong>When deliveries arrive:</strong></p>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>\u2713</strong> on each item that arrived correctly \u2014 it turns green.</li>" +
            "<li>Click <strong>\u2717</strong> if an item wasn\u2019t delivered \u2014 it turns red.</li>" +
            "<li>Click <strong>\u26A0</strong> for a wrong pick \u2014 a modal asks you to log the return reason.</li>" +
            "<li>Use <strong>\u2713 All Received</strong> on a supplier group to mark everything at once.</li>" +
            "</ol>" +
            "<p><strong>End of day:</strong></p>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Carry Over</strong> \u2014 all pending, not-received, and wrong-pick items move to tomorrow automatically.</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Click the quantity cell (dotted underline) to edit it inline.</li>" +
            "<li>Quotation hints appear in the edit modal showing matching cost data from your quotations.</li>" +
            "<li>The stat bar at top shows: Total / Received / Pending / Not Received / Wrong Pick.</li>" +
            "<li>Use \u25C0 / \u25B6 arrows to navigate between days, or click <strong>Today</strong> to jump back.</li>" +
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
            "<p>Manage deliveries from scheduling through dispatch and delivery. " +
            "Three tabs: <strong>Active</strong> (in-progress), <strong>Completed</strong> (delivered), " +
            "and <strong>Failed / Returned</strong>.</p>"
        },
        {
          heading: "How to Create a Delivery",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>+ New Delivery</strong>.</li>" +
            "<li>Fill in the client details: name, phone, and email.</li>" +
            "<li>Set the <strong>delivery address</strong> \u2014 either type it or click on the <strong>map</strong> to drop a pin (reverse geocoding fills the address).</li>" +
            "<li>Choose the <strong>delivery method</strong> (In-house Driver, Courier, or Collection) and <strong>priority</strong>.</li>" +
            "<li>Add items to the delivery: enter name, quantity, and optionally batch ref and expiry per row.</li>" +
            "<li>Assign a <strong>driver</strong> (or add a new one on-the-fly).</li>" +
            "<li>Click <strong>Save</strong> \u2014 the delivery gets an auto-generated ID (DEL-00001 format) and appears in the Active tab.</li>" +
            "</ol>"
        },
        {
          heading: "How to Complete a Delivery",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Find the delivery in the <strong>Active</strong> tab and update its status as it progresses: Scheduled \u2192 Dispatched \u2192 Out for Delivery.</li>" +
            "<li>When delivered, click <strong>\u2705 Mark Delivered</strong> \u2014 enter actual date, time, and recipient name.</li>" +
            "<li>If delivery fails, click <strong>\u2717 Mark Failed</strong> \u2014 log the reason. The attempt counter increments. After 3 failed attempts, status auto-changes to Returned.</li>" +
            "<li>Use <strong>+ Add Log Entry</strong> at each status change to build a clear audit trail.</li>" +
            "</ol>"
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
            "<p>Schedule pharmacy consultations and medical check-ups. Views: Month, Week, Day, All Appointments, and Waiting List.</p>"
        },
        {
          heading: "First-Time Setup",
          body:
            "<p>Before you can book appointments, set up these three things in the <strong>Settings</strong> menu:</p>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li><strong>Manage Doctors</strong> \u2014 Add each doctor (name, specialty, phone, default fee).</li>" +
            "<li><strong>Manage Clinics</strong> \u2014 Add each clinic location (name, locality, phone, standard fee).</li>" +
            "<li><strong>Manage Schedules</strong> \u2014 Link a doctor to a clinic with their available times and slot duration (5\u2013120 min). Can be recurring (weekly) or one-off.</li>" +
            "</ol>" +
            "<p>Once set up, available slots auto-generate and you can start booking.</p>"
        },
        {
          heading: "How to Book an Appointment",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New Appointment</strong> (or click an empty slot in the Day/Week view).</li>" +
            "<li>Enter the <strong>patient name</strong>, <strong>ID card</strong>, and <strong>phone</strong>.</li>" +
            "<li>Select a <strong>doctor</strong> \u2014 the clinic dropdown auto-filters to that doctor\u2019s locations.</li>" +
            "<li>Select a <strong>clinic</strong> and <strong>session date</strong> \u2014 only dates with availability appear.</li>" +
            "<li>Pick an <strong>available time slot</strong> \u2014 double-booked slots are blocked automatically.</li>" +
            "<li>Fees auto-fill from clinic settings. Adjust if needed and add medicines/items.</li>" +
            "<li>Click <strong>Save</strong> \u2014 the appointment appears on the calendar.</li>" +
            "</ol>"
        },
        {
          heading: "Status Flow",
          body:
            "<p><strong>Scheduled</strong> \u2192 <strong>Confirmed</strong> \u2192 <strong>Completed</strong> (or Cancelled / No Show)</p>" +
            "<p>Update status from the detail panel or right-click menu. Cancelled appointments require a reason.</p>"
        },
        {
          heading: "Waiting List",
          body:
            "<p>When no slots are available, click <strong>Add to Waiting List</strong> instead. Enter doctor/clinic preference, " +
            "preferred dates, and flexibility level. When a slot opens, convert to a real appointment with one click.</p>" +
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
            "<p>Track customer issues from creation through resolution with priorities, assignment, " +
            "categories, and a timestamped notes log per ticket.</p>"
        },
        {
          heading: "How to Handle a Customer Issue",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Create Ticket</strong> \u2014 an ID auto-generates (TKT-00001 format).</li>" +
            "<li>Fill in the client\u2019s <strong>name</strong>, <strong>phone</strong>, and <strong>issue description</strong>.</li>" +
            "<li>Select a <strong>category</strong> and <strong>priority</strong>.</li>" +
            "<li><strong>Assign</strong> the ticket to a staff member (or yourself).</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "<li>As you work on it, click <strong>Add Note</strong> to log each update with a timestamp.</li>" +
            "<li>Update the <strong>status</strong> as it progresses: Open \u2192 In Progress \u2192 Pending \u2192 Resolved.</li>" +
            "<li>Once fully resolved, set status to <strong>Closed</strong>.</li>" +
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
            "<p>Run multiple loyalty campaigns simultaneously (Stamp Card, Points, Discount, Event, Buy X Get Y, Tiered). " +
            "Customers register via Maltese ID card and can participate in multiple campaigns at once.</p>"
        },
        {
          heading: "How to Create a Campaign",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Go to the <strong>Campaigns</strong> tab and click <strong>New Campaign</strong>.</li>" +
            "<li>Choose a <strong>campaign type</strong> (Stamp Card, Points, Discount, Event, Buy X Get Y, or Tiered).</li>" +
            "<li>Enter the campaign <strong>name</strong>, <strong>description</strong>, and optionally set start/end dates.</li>" +
            "<li>Fill in the type-specific settings (e.g. stamps required, points per \u20AC1, discount %).</li>" +
            "<li>Click <strong>Save</strong> \u2014 the campaign is now Active and ready for transactions.</li>" +
            "</ol>"
        },
        {
          heading: "How to Record a Transaction",
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
            "commit orders per supplier, and track them from draft to received. " +
            "Two tabs: <strong>Inventory</strong> (browse and order) and <strong>My Orders</strong> (track and receive).</p>"
        },
        {
          heading: "How to Place an Order",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Go to the <strong>Inventory</strong> tab and search for a product by name, barcode, or stock code.</li>" +
            "<li>Click <strong>Add to Cart</strong> on the items you need \u2014 set the quantity (deal multiples are respected automatically).</li>" +
            "<li>Repeat for all items. The cart groups items by supplier.</li>" +
            "<li>Open the <strong>Cart</strong>, review items and quantities per supplier.</li>" +
            "<li>Click <strong>Commit Order</strong> for each supplier \u2014 optionally add order notes.</li>" +
            "<li>The order moves to <strong>My Orders</strong> tab with status Pending.</li>" +
            "</ol>"
        },
        {
          heading: "How to Receive an Order",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Go to <strong>My Orders</strong> and find the order (status: Shipped or Pending).</li>" +
            "<li>Click <strong>Mark Received</strong>.</li>" +
            "<li>If there\u2019s a problem with any item, click <strong>Report Problem</strong> and select the reason: " +
            "Not Received, Wrong Pick, Damaged, Short Quantity, or Other.</li>" +
            "<li>Track supplier responses as resolution statuses appear (Acknowledged, Replacement Sent, Credit Issued, etc.).</li>" +
            "</ol>"
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
          heading: "How to Process a Recall or Quarantine",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Add Alert</strong> and fill in the item details (name, type, batch, storage location).</li>" +
            "<li>Click <strong>Save</strong> \u2014 the alert appears in the table with status Open.</li>" +
            "<li>Click the row to select it \u2014 the <strong>checklist panel</strong> opens on the right.</li>" +
            "<li>Work through the 7 steps: inform your team, contact the supplier, notify authorities, arrange the return.</li>" +
            "<li>Check each item as it\u2019s completed \u2014 changes <strong>auto-save</strong> with a timestamp.</li>" +
            "<li>Update the alert status: <strong>Open</strong> \u2192 <strong>In Progress</strong> \u2192 <strong>Closed</strong> as actions are completed.</li>" +
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
            "<p>Transfer items between pharmacies in your organisation. The <strong>Available Items</strong> tab " +
            "shows items you\u2019re offering; the <strong>My Requests</strong> tab shows requests you\u2019ve sent.</p>"
        },
        {
          heading: "How to Offer an Item for Transfer",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>Place for Transfer</strong>.</li>" +
            "<li>Enter the <strong>item description</strong>, <strong>quantity</strong>, and optionally batch and expiry.</li>" +
            "<li>Click <strong>Save</strong> \u2014 the item appears in the Available Items tab and is visible to other pharmacies.</li>" +
            "</ol>"
        },
        {
          heading: "How to Handle Incoming Requests",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>When another pharmacy requests your item, expand the row in the <strong>Available Items</strong> tab to see the request details.</li>" +
            "<li>Click <strong>Accept</strong> (or <strong>Reject</strong> if you can\u2019t fulfil it).</li>" +
            "<li>When you\u2019ve packed and sent the item, click <strong>Confirm Dispatch</strong>.</li>" +
            "<li>The receiving pharmacy clicks <strong>Confirm Received</strong> on their end to complete the transfer.</li>" +
            "</ol>" +
            "<p>Status flow: <strong>Open</strong> \u2192 <strong>Requested</strong> \u2192 <strong>Accepted</strong> \u2192 <strong>Dispatched</strong> \u2192 <strong>Delivered</strong>. " +
            "Expired items are automatically flagged and cannot be transferred.</p>"
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
          heading: "How to Create a Return",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click <strong>New</strong>.</li>" +
            "<li>Enter the <strong>description</strong> (item name) and fill in what you have: expiry, batch, quantity, supplier, invoice number.</li>" +
            "<li>Click a <strong>remarks chip</strong> (Wrong Pick, Expiring soon, Damaged, etc.) or type a custom reason.</li>" +
            "<li>Note the <strong>location stored</strong> (e.g. \"Back room / Fridge\").</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "<li>Select the row to open the <strong>checklist panel</strong>, then check off each step as you go:</li>" +
            "</ol>" +
            "<ul>" +
            "<li>Return arranged \u2192 Handed over \u2192 Collection note received \u2192 Credit note received</li>" +
            "</ul>" +
            "<p>If the supplier refuses, click <strong>Mark as Refused</strong> \u2014 a red warning box appears and " +
            "all checklist items (except Damaged) are disabled.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Use <strong>Copy for Email</strong> to paste return details into an email to the supplier.</li>" +
            "<li>Use <strong>Place on Transfer</strong> to move the item to Stock Transfers for another pharmacy.</li>" +
            "<li>Returns created from Near Expiry show a \u201CFrom Near Expiry\u201D badge.</li>" +
            "<li>Filtered by month \u2014 use the month selector at the top. Search filters as you type.</li>" +
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
          heading: "How to Track a Near-Expiry Item",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Type the <strong>product name</strong> and select the <strong>expiry date</strong> in the form at the top.</li>" +
            "<li>Optionally add a <strong>location</strong> and <strong>notes</strong>.</li>" +
            "<li>Click <strong>Add</strong> (or press Enter) \u2014 the item appears in the table with a colour-coded urgency pill.</li>" +
            "<li>When you\u2019re ready to return it, click the <strong>Return</strong> button on the row \u2014 enter supplier and quantity, and a linked entry is created in the Returns module.</li>" +
            "<li>To offer it to another pharmacy, click <strong>Add to Scarce Stock</strong> instead.</li>" +
            "</ol>"
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
          heading: "How to Offer Stock You Have",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Switch to the <strong>Available Stock</strong> view.</li>" +
            "<li>Click <strong>New offer</strong>.</li>" +
            "<li>Enter the <strong>item name</strong>, <strong>quantity</strong>, and optionally batch, expiry, and a public description.</li>" +
            "<li>Click <strong>Save</strong> \u2014 the item is now visible to all pharmacies in your organisation.</li>" +
            "<li>When another pharmacy requests your stock, expand the row to see the request and click <strong>Accept</strong> or <strong>Reject</strong>.</li>" +
            "<li>After accepting, click <strong>Confirm Dispatch</strong> when you send it.</li>" +
            "</ol>"
        },
        {
          heading: "How to Post a Need",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Switch to the <strong>Stock Needs</strong> view.</li>" +
            "<li>Click <strong>New offer</strong> (the form adapts to need fields).</li>" +
            "<li>Enter the <strong>item name</strong>, <strong>quantity needed</strong>, and optionally a <strong>needed by</strong> date.</li>" +
            "<li>Click <strong>Save</strong> \u2014 other pharmacies can now offer stock to fulfil your need.</li>" +
            "<li>When offers come in, expand the row and click <strong>Accept</strong> on the best one.</li>" +
            "</ol>"
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
          heading: "How to Send a Message",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Type your message in the text box at the bottom (max 2000 chars).</li>" +
            "<li>To mention someone, type <code>@</code> and select from the autocomplete list.</li>" +
            "<li>To create a suggestion, include a <code>#</code>hashtag \u2014 it\u2019ll be auto-extracted to the Suggestions table.</li>" +
            "<li>Choose the scope: <strong>Organisation</strong> (your org only) or <strong>All</strong> (all pharmacies \u2014 confirmation required).</li>" +
            "<li>Press <strong>Enter</strong> or click <strong>Send</strong>.</li>" +
            "<li>To pin an important message, click <strong>Pin</strong> on it (up to 30 pinned messages).</li>" +
            "</ol>"
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
            "Systems, Clinical, and Settings. Each tab has rich-text editors with Edit/Save/Cancel and \u201CLast updated\u201D timestamps.</p>"
        },
        {
          heading: "How to Do a Daily Handover",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Open the <strong>Daily &amp; Handover</strong> tab.</li>" +
            "<li>Click today\u2019s date on the calendar (or it\u2019s already selected).</li>" +
            "<li>Check the <strong>Handover From Previous Day</strong> section \u2014 review any bullets left by the previous shift.</li>" +
            "<li>If useful, click <strong>Append to Day Notes</strong> to merge them into today\u2019s notes.</li>" +
            "<li>Write today\u2019s notes in the <strong>Day Specific Instructions</strong> box (click Edit first).</li>" +
            "<li>Before leaving, add <strong>Handover Bullets</strong> for the next shift:</li>" +
            "</ol>" +
            "<ul>" +
            "<li>Click <strong>+ Add Bullet</strong>, type the message, and select severity " +
            "(<strong style=\"color:var(--ok)\">Low</strong>, " +
            "<strong style=\"color:#e8b635\">Medium</strong>, " +
            "<strong style=\"color:var(--danger)\">Critical</strong>).</li>" +
            "<li>These automatically appear as \u201CHandover From Previous Day\u201D for the next person.</li>" +
            "</ul>"
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
          heading: "How to Record a Test",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Click the test type in the sidebar (e.g. Blood Pressure, HbA1c, Cholesterol).</li>" +
            "<li>Click <strong>New Record</strong>.</li>" +
            "<li>Enter the <strong>patient ID card</strong> \u2014 name auto-fills from previous records.</li>" +
            "<li>Fill in the test <strong>results</strong> (fields vary per test type). Results auto-colour based on reference ranges.</li>" +
            "<li>Optionally record the <strong>fee</strong>.</li>" +
            "<li>Click <strong>Save</strong>.</li>" +
            "<li>To view a patient\u2019s history, click <strong>View Patient</strong> on any of their records.</li>" +
            "</ol>"
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
            "stock tracking, order creation, and an interactive world map. Four tabs: Travel, Routine &amp; Other, Stock, and Database.</p>"
        },
        {
          heading: "How to Create a Travel Vaccine Order",
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
          heading: "How to Find an OCP",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Select an <strong>estrogen type</strong> from the dropdown (or leave empty to search all).</li>" +
            "<li>Select a <strong>progestogen type</strong> from the dropdown (or leave empty).</li>" +
            "<li>Optionally enter a <strong>dose</strong> and toggle the unit between <strong>mg</strong> and <strong>mcg</strong>.</li>" +
            "<li>Results appear immediately \u2014 showing trade name, hormone types, and doses.</li>" +
            "<li>Multiphasic pills are flagged in the results.</li>" +
            "<li>Click <strong>Print</strong> to generate a printable list for the patient.</li>" +
            "</ol>" +
            "<p>All fields are optional \u2014 leave them empty to see all available pills. Dose matching uses \u00B11% tolerance for rounding.</p>"
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
          heading: "How to Use a Calculator",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Select a calculator tab (<strong>LEV</strong>, <strong>PRED</strong>, <strong>WAR</strong>, <strong>INS</strong>, or <strong>MTX</strong>).</li>" +
            "<li>Enter the <strong>patient name</strong>, <strong>start date</strong>, and <strong>duration</strong> (weeks).</li>" +
            "<li>Fill in the dose-specific fields for that calculator (see table below).</li>" +
            "<li>Click <strong>Calculate</strong> \u2014 the results table appears in the right panel showing dates, doses, and tablet combinations.</li>" +
            "<li>Review the schedule and click <strong>Save &amp; Print</strong> to store the record and generate a printable A4 patient instruction sheet.</li>" +
            "</ol>"
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
          heading: "How to File an ADR Report",
          body:
            "<p>Click <strong>New Report</strong> to start the 5-step wizard. Work through each step in order:</p>" +
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li><strong>Patient Information</strong> \u2014 Enter patient <strong>initials</strong> (not full name, for privacy), sex, date of birth, and medical history. Click <strong>Next</strong>.</li>" +
            "<li><strong>Suspected Drug(s)</strong> \u2014 Enter the <strong>drug name</strong>, dose, route, frequency, and start/stop dates. " +
            "Include the <strong>batch number</strong> for traceability. Click <strong>+ Add Drug</strong> if multiple drugs are suspected. Click <strong>Next</strong>.</li>" +
            "<li><strong>Reaction / ADR</strong> \u2014 Describe the reaction, then start typing the <strong>MedDRA term</strong> to select from 100+ standard terms. " +
            "Set the <strong>seriousness</strong>, <strong>outcome</strong>, and <strong>causality</strong> assessment. Click <strong>Next</strong>.</li>" +
            "<li><strong>Reporter Information</strong> \u2014 Enter your name, qualification (Pharmacist/Physician/Nurse/Patient/Other), organisation, and contact details. Click <strong>Next</strong>.</li>" +
            "<li><strong>Review &amp; Submit</strong> \u2014 Review the summary. Click any section heading to jump back and correct. When ready, click <strong>Submit</strong> (or <strong>Save Draft</strong> to finish later).</li>" +
            "</ol>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Use MedDRA term autocomplete for standard reaction terminology.</li>" +
            "<li>Save as Draft first, review, then Submit when confident.</li>" +
            "<li>Include batch numbers for product traceability.</li>" +
            "<li>Use initials only (not full names) for patient privacy.</li>" +
            "<li>Report statuses: Preliminary \u2192 Follow-up \u2192 Final.</li>" +
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
            "Integrates with POCT for test recording, tracks participants, follow-ups, and generates summary reports. " +
            "Four tabs: Campaigns, All Participants, Follow-ups, and Summary.</p>"
        },
        {
          heading: "How to Run a Screening Event",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Go to <strong>Campaigns</strong> and click <strong>New Campaign</strong>.</li>" +
            "<li>Choose the <strong>campaign type</strong> (e.g. Blood Pressure, Diabetes), set dates, and optionally a target goal.</li>" +
            "<li>Click <strong>Save</strong> \u2014 the campaign is active.</li>" +
            "<li>To add a participant, click <strong>Add Participant</strong> on the campaign.</li>" +
            "<li>Enter their <strong>ID card</strong> (auto-fills name from POCT records if known), phone, and screening date.</li>" +
            "<li>POCT fields auto-appear based on the campaign type \u2014 fill in the results.</li>" +
            "<li>Select a <strong>result category</strong> (Normal / Borderline / Abnormal / Requires urgent attention) and <strong>referral</strong> type.</li>" +
            "<li>Click <strong>Save</strong>. If follow-up is needed, go to the <strong>Follow-ups</strong> tab to schedule it.</li>" +
            "</ol>"
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
          heading: "How to Look Up a Product or Symptom",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Type a <strong>product name</strong> or <strong>symptom</strong> in the search box \u2014 the graph jumps to that node.</li>" +
            "<li><strong>Click the node</strong> to load its details in the side panel.</li>" +
            "<li>Review the side panel sections:" +
            "<ul>" +
            "<li><strong>Symptom links</strong> \u2014 What symptoms this product treats.</li>" +
            "<li><strong>Similar products</strong> \u2014 Alternatives the patient could use.</li>" +
            "<li><strong>Complementary products</strong> \u2014 What works well alongside it.</li>" +
            "<li><strong>Guardrails</strong> \u2014 Safety warnings and interactions to check before recommending.</li>" +
            "</ul></li>" +
            "<li>Click connected nodes to explore further. Use <strong>zoom/pan</strong> (buttons or mouse drag) to navigate.</li>" +
            "<li>Adjust the <strong>score threshold</strong> slider to hide weaker connections.</li>" +
            "</ol>"
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
            "<p>Centralised contact directory with emergency numbers, public clinic references, and editable tables " +
            "for clients, suppliers, doctors, specialists, locums, medical reps, head office, and POYC. " +
            "Most tables are <strong>shared</strong> across your organisation \u2014 changes you make are visible to all locations.</p>"
        },
        {
          heading: "How to Add or Find a Contact",
          body:
            "<ol style=\"padding-left:20px;margin:0 0 14px\">" +
            "<li>Scroll to the relevant table (e.g. Suppliers, Doctors, Specialists).</li>" +
            "<li>Click <strong>+ Add</strong> and fill in the fields for that table.</li>" +
            "<li>Click <strong>Save</strong>. For shared tables, a confirmation modal warns that changes affect all locations.</li>" +
            "</ol>" +
            "<p>To find a contact, use the <strong>Global Search</strong> at the top \u2014 it searches across all tables, " +
            "emergency numbers, and clinics. Each table also has its own search box for focused filtering.</p>"
        },
        {
          heading: "Tips",
          body:
            "<ul>" +
            "<li>Use <strong>Export</strong> to download any table as Google Contacts\u2013compatible CSV.</li>" +
            "<li>Use <strong>Import</strong> to paste CSV for bulk additions (rows are appended, not replaced).</li>" +
            "<li>Doctors and Specialists have separate <em>Personal</em> and <em>Patient-Safe</em> phone fields.</li>" +
            "<li>Print the emergency numbers section for wall display.</li>" +
            "</ul>"
        }
      ]
    }

  ];

  // Invalidate cache so showHelpGuide rebuilds with new content
  E._helpContentById = null;

})();
