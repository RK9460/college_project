# 🎒 Group Expense Splitter — College Trip Edition

> **Smart, 100% Offline Single-Page Web Application for College Hackathon Demos**  
> Split trip expenses, track personal spending on behalf of friends, minimize settlement transactions, and settle up cleanly with zero internet needed.

---

## 🏗️ Architecture & Project Structure

A clean, modular, and professional repository layout separating presentation, styling, and business logic:

```text
college_project/
├── index.html                   # Semantic HTML5 Layout & Structure
├── README.md                    # Project Documentation & Hackathon Pitch Guide
├── css/
│   └── style.css                # Modular CSS3 Design System & Responsive Theme
└── js/
    └── app.js                   # Complete JavaScript Engine (Clean single-file < 1000 lines, 8 Sections)
```

---

## ✨ Key Features & Capabilities

1. **👥 Friends Management:**
   - Add/edit/delete members with optional UPI IDs (e.g., `rahul@okhdfcbank`).
   - Avatar badges and duplicate name validation.

2. **🎯 Advanced Expense Splitting:**
   - **Equal Split (All Friends):** Shared expenses (Hotel, Cabs, Dhaba).
   - **Paid on Behalf of Someone (1-on-1 Personal Spend):** When friend A pays for friend B's personal shopping, ticket, or medicines. Friend B owes 100% of the amount directly to Friend A; other friends are unaffected.
   - **Selected Friends Custom Split:** Split an activity (e.g. River Rafting, Go-Karting) only between specific friends who participated.

3. **💸 Greedy Transaction-Minimizing Settlement Algorithm:**
   - Automatically pairs the largest debtor with the largest creditor.
   - Mathematically guarantees that everyone is settled up in **at most $(N - 1)$ transactions**.

4. **💾 Browser-Native IndexedDB Storage Engine:**
   - Real browser database (`TripSplitterDB` v1) with 3 object stores: `members`, `expenses`, and `config`.
   - Dual-write `localStorage` fallback ensuring zero data loss across browser tabs and refreshes.

5. **📊 Visual Analytics & Budget Tracker:**
   - Trip Budget progress bar with warning alerts at 80% and over-budget thresholds.
   - Inline SVG category & member spending breakdown charts.

6. **📤 Export & Sharing Suite:**
   - **1-Click WhatsApp Share:** Formats trip breakdown with balances and suggested payments.
   - **Download Summary Report (.txt):** Professional audit text file.
   - **Export CSV:** Opens in Microsoft Excel or Google Sheets.

---

## 🚀 How to Run

Because this project is built with **zero external runtime dependencies**, you can run it instantly on any laptop:

### Option 1: Direct File Launch (No Server Required)
Simply double-click `index.html` in your file explorer. It will open in Chrome, Edge, or Firefox and run 100% offline.

### Option 2: Live Server (VS Code / Localhost)
Open the `college_project` folder in VS Code, right-click `index.html`, and select **"Open with Live Server"**.

---

## 🧪 Automated Self-Test Suite

Open browser DevTools (`F12`), switch to the **Console** tab, and type:
```javascript
runSelfTests()
```
It executes 23 assertions covering mathematical invariants, paise-level precision, settlement pairing, and XSS sanitization.

---

## 🎓 College Hackathon Presentation Pitch

When presenting to judges:
1. **The Problem:** *"College trips hamesha messy hote hain jab bill split karna ho—kisi ke paas cash nahi hota, kisi ka personal expense dusra dost pay karta hai, aur end me 20 alag-alag transactions ho jate hain."*
2. **The Solution:** *"Group Expense Splitter settles everyone in $\le N - 1$ payments, handles personal shopping on behalf of friends, and works 100% offline via IndexedDB without needing any internet connection or cloud server!"*
3. **The Tech Stack:** *"Vanilla HTML5, Modular CSS3, Clean JavaScript Modules, Browser-Native IndexedDB, and Pure Math Algorithms."*
