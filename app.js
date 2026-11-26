// ==========================================================================
// app.js — R.R. Motorcycle Shop & Parts (BSIT IT100 Project 2026)
// Daet, Camarines Norte Branch Management & Storefront Platform
//  1. Helpers, Debouncers & State Recovery
//  2. Theme & Left Sidebar Navigation
//  3. Data Layer & Pre-Seeded Catalog (Services with Turnaround & Parts)
//  4. Practical Shop Pricing Engine (Customer Parts vs Shop Parts)
//  5. In-Website Visual CMS Manager (Firestore Real-time Sync)
//  6. Search Engine
//  7. Bay Reservation Workflow, Validation & ₱50.00 GCash Downpayment
//  8. J&T-Style Turnaround & Milestone Repair Tracker
//  9. Shop Business & Operations Analytics Dashboard
// 10. Authentication & Admin Workflow (Proof Photo Upload & Status Actions)
// ==========================================================================

import { auth, db, storage, configured, emailjsConfig } from "./firebase-config.js";
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  sendPasswordResetEmail 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  collection, 
  getDocs, 
  getDoc, 
  doc, 
  addDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/* ==========================================================================
   1. HELPERS, DEBOUNCERS & STATE RECOVERY
   ========================================================================== */
const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];

const esc = (str) =>
  String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

const peso = (num) =>
  num !== null && num !== undefined && num !== "" && !isNaN(num)
    ? "₱" + Number(num).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "Ask for quote";

// Standard 5-Stage Service Life Cycle
const STATUSES = ["Pending", "Approved", "In-Service", "Ready for Pick-Up", "Completed"];

// Debounce helper to prevent freezing and network lag
function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Timeout wrapper for Firestore operations with local fallback
async function withTimeout(promise, ms = 4500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Network timeout: switching to local cache")), ms))
  ]);
}

function formatDateTime(timestamp) {
  if (!timestamp) return { full: "Recent", relative: "Just now" };
  let date;
  if (typeof timestamp.toDate === "function") {
    date = timestamp.toDate();
  } else if (timestamp.seconds) {
    date = new Date(timestamp.seconds * 1000);
  } else {
    date = new Date(timestamp);
  }

  if (isNaN(date.getTime())) return { full: "Recent", relative: "Just now" };

  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let relative = "Just now";
  if (diffMins >= 1 && diffMins < 60) relative = `${diffMins}m ago`;
  else if (diffHours >= 1 && diffHours < 24) relative = `${diffHours}h ago`;
  else if (diffDays >= 1) relative = `${diffDays}d ago`;

  const full = new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);

  return { full, relative };
}

function toast(message, duration = 3000) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), duration);
}

function msg(el, text, ok = true) {
  if (!el) return;
  el.textContent = text;
  el.className = "form-alert " + (ok ? "ok" : "err");
  el.classList.remove("hidden");
}

// Global modal triggers
document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-open]");
  if (opener) {
    e.preventDefault();
    const targetModal = $("#" + opener.dataset.open);
    if (targetModal && typeof targetModal.showModal === "function") {
      targetModal.showModal();
    }
  }

  const closer = e.target.closest("[data-close]");
  if (closer) {
    const parentDialog = closer.closest("dialog");
    if (parentDialog) parentDialog.close();
  }

  const copyBtn = e.target.closest("[data-copy]");
  if (copyBtn) {
    const val = copyBtn.dataset.copy;
    if (val && navigator.clipboard) {
      navigator.clipboard.writeText(val).then(() => {
        toast(`Copied: ${val}`);
      }).catch(() => {});
    }
  }
});

// Close dialog when clicking on backdrop
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    const rect = d.getBoundingClientRect();
    const isInDialog =
      rect.top <= e.clientY &&
      e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX &&
      e.clientX <= rect.left + rect.width;
    if (!isInDialog) d.close();
  });
});

/* ==========================================================================
   2. THEME & LEFT SIDEBAR NAVIGATION
   ========================================================================== */
const root = document.documentElement;
const savedTheme = localStorage.getItem("rr-theme") || "dark";
root.dataset.theme = savedTheme;

const themeBtn = $("#themeBtn");
if (themeBtn) {
  themeBtn.onclick = () => {
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    localStorage.setItem("rr-theme", nextTheme);
  };
}

const burger = $("#burger");
const sidebar = $("#sidebar");
const linksMenu = $("#links");
const navBackdrop = $("#navBackdrop");

function toggleMenu(force) {
  if (!sidebar) return;
  const isOpen = force !== undefined ? force : !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", isOpen);
  if (burger) {
    burger.classList.toggle("open", isOpen);
    burger.setAttribute("aria-expanded", String(isOpen));
  }
  if (navBackdrop) navBackdrop.classList.toggle("show", isOpen);
  document.body.style.overflow = isOpen ? "hidden" : "";
}

if (burger) burger.onclick = () => toggleMenu();
if (navBackdrop) navBackdrop.onclick = () => toggleMenu(false);
if (linksMenu) {
  linksMenu.addEventListener("click", (e) => {
    if (e.target.closest("a")) toggleMenu(false);
  });
}

/* ==========================================================================
   4. DATA LAYER & PRE-SEEDED CATALOG (SERVICES & PARTS INVENTORY)
   ========================================================================== */
const DEFAULT_SERVICES = [
  { id: "s1", title: "Ultrasonic Throttle Body Cleaning", category: "Core", description: "Ultrasonic cavitation cleaning of fuel injector nozzles and intake manifold to restore crisp throttle response.", price: 650, turnaround: "Same Day (~1–2 hours)" },
  { id: "s2", title: "CVT Deep Cleaning & Inspection", category: "Core", description: "Complete disassembly, degreasing of drive face, torque drive regreasing, and belt wear measurement.", price: 500, turnaround: "Same Day (~1–2 hours)" },
  { id: "s3", title: "Magneto Cleaning w/ Repaint", category: "Core", description: "Removal of road grime and stator rust buildup, with thermal protective anti-corrosion repaint.", price: 750, turnaround: "Same Day (~2–3 hours)" },
  { id: "s4", title: "Comprehensive Engine Tune-Up", category: "Core", description: "Valve clearance lash adjustment, spark plug gap test, synthetic oil flush, and compression benchmark.", price: 800, turnaround: "Same Day (~2–3 hours)" },
  { id: "s5", title: "T-Post Bearing Replacement", category: "Core", description: "Steering head race alignment and heavy-duty tapered bearing repacking for sharp cornering stability.", price: 450, turnaround: "Same Day (~2–3 hours)" },
  { id: "s6", title: "Custom CVT Set Up & Tuning", category: "Core", description: "Precision weight roller matching, center spring tension tuning, and pulley angle profiling.", price: 950, turnaround: "Same Day (~3–4 hours)" },
  { id: "s7", title: "ECU Diagnostics & Fault Scan", category: "Core", description: "OBD live parameter analysis, sensor health check (TPS, MAP, O2), and trouble code clearing.", price: 400, turnaround: "Same Day (~45–60 mins)" },
  { id: "s8", title: "Stock ECU Remapping", category: "Core", description: "Factory ECU reflash optimizing ignition timing curves, AFR fueling maps, and rev limiter release.", price: 3500, turnaround: "1 Day (~24 hours)" },
  { id: "s9", title: "Dyno Run & Benchmark Test", category: "Core", description: "High-precision chassis dynamometer wheel horsepower and torque benchmark runs with printed power graph.", price: 1500, turnaround: "Same Day (~2–3 hours)" },
  { id: "s10", title: "Standalone ECU Live Calibration", category: "Core", description: "Live dynamometer calibration for aftermarket programmable ECUs (UMA, Pitsbike, Aracer) across all throttle positions.", price: 4500, turnaround: "1–2 Days" },
  { id: "s11", title: "Preventive Maintenance Package (PMS)", category: "Maintenance & Upgrades", description: "Complete 25-point bumper-to-bumper mechanical, brake fluid, coolant, and electrical safety check.", price: 1200, turnaround: "Same Day (~3–4 hours)" },
  { id: "s12", title: "Mini Driving Light (MDL) Installation", category: "Maintenance & Upgrades", description: "Clean OEM-style wiring with dual waterproof relays, illuminated toggle switch, and high/low beam integration.", price: 850, turnaround: "Same Day (~2–3 hours)" }
];

const DEFAULT_PARTS = [
  { id: "p1", title: "R.R. Stage 1 Remap Module", category: "ECU & Electrical", subpart: "Remap Module", fitment: "Mio i125 / Aerox 155 / Click", description: "Plug-and-play reflashed ECU unit tuned specifically for Philippine fuels and everyday commuting.", price: 3500, stock: "In Stock", image: "https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&w=800&q=80" },
  { id: "p2", title: "Koso High Performance Drive Belt", category: "CVT & Transmission", subpart: "Drive Belt", fitment: "Aerox 155 / NMAX V1 & V2", description: "Aramid-reinforced fiber drive belt with high thermal resistance for prolonged high-RPM highway cruising.", price: 1250, stock: "In Stock", image: "https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=800&q=80" },
  { id: "p3", title: "Competition CVT Roller Weights 9g", category: "CVT & Transmission", subpart: "Flyball Rollers", fitment: "Mio Sporty / Click 125i / Beat", description: "Self-lubricating Teflon composite rollers. Lightweight for rapid 0-60 kph acceleration.", price: 450, stock: "Low Stock", image: "https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?auto=format&fit=crop&w=800&q=80" },
  { id: "p4", title: "Dual Mini Driving Light 60W Set", category: "Accessories & Lighting", subpart: "MDL Auxiliary Light", fitment: "Universal Fit (All Models)", description: "Yellow low beam / White high beam auxiliary lights with aviation aluminum cooling casing.", price: 950, stock: "In Stock", image: "https://images.unsplash.com/photo-1588702547919-26089e690ecc?auto=format&fit=crop&w=800&q=80" },
  { id: "p5", title: "UMA Racing Standalone M5 ECU", category: "ECU & Electrical", subpart: "Racing ECU", fitment: "Sniper 150 / Raider 150 Fi", description: "Bluetooth-tuneable racing ECU with live smartphone sensor telemetry and launch control.", price: 9800, stock: "Pre-Order", image: "https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=800&q=80" },
  { id: "p6", title: "Spec V 160cc High Flow Injector", category: "Engine & Performance", subpart: "Fuel Injector Nozzle", fitment: "Aerox 155 / Click 150i", description: "Precision 10-hole spray pattern injector nozzle for big bore or high-compression head builds.", price: 1650, stock: "In Stock", image: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=800&q=80" }
];

const DEFAULT_MOTORS = [
  { id: "m1", title: "Kawasaki Ninja 250r Super Sport", category: "Manual", description: "Stage 2 tuned with 59mm bore, ported head, quickshifter, and candy racing red fairings.", image: "ninja250r.jpg" },
  { id: "m2", title: "Honda Click 125 v2 Urban Runner", category: "Automatic", description: "Equipped with custom CVT pulley angle, 9g Teflon flyballs, and upgraded rear shocks.", image: "click125v.jpg" },
  { id: "m3", title: "Honda Tmx 155 Scrambler Build", category: "Manual", description: "A high-torque utility motorcycle custom rebuilt for classic aesthetic and bulletproof reliability.", image: "tmxko.jpg" }
];

const DEFAULT_ACCOMPLISHMENTS = [
  { id: "a1", title: "Dyno Run & ECU Calibration (Honda Click 150i)", category: "Dyno Tuning", description: "Eliminated mid-range throttle flat spots and extracted +2.1 WHP over factory tune with crisp roll-on response.", before: "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=800&q=80", after: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=800&q=80" },
  { id: "a2", title: "Complete CVT Restoration & Degreasing", category: "Engine & CVT", description: "Restored worn pulleys, ultrasonic cleaned carbon soot, replaced sliders, and installed brand new drive belt.", before: "https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=800&q=80", after: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=800&q=80" }
];

// In-Memory & LocalStorage Cache
const cache = {
  services: [],
  motors: [],
  parts: [],
  accomplishments: [],
  bookings: []
};

// Check and load data from Firestore or local storage
async function loadAll() {
  const collections = ["services", "motors", "parts", "accomplishments"];
  
  for (const coll of collections) {
    let loaded = false;
    if (configured && db) {
      try {
        const snap = await withTimeout(getDocs(collection(db, coll)), 3500);
        if (snap && !snap.empty) {
          cache[coll] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          localStorage.setItem(`rr_${coll}`, JSON.stringify(cache[coll]));
          loaded = true;
        }
      } catch (err) {
        console.warn(`Firestore read fallback for [${coll}]:`, err.message);
      }
    }

    if (!loaded) {
      const local = localStorage.getItem(`rr_${coll}`);
      if (local) {
        try { cache[coll] = JSON.parse(local); loaded = true; } catch (_) {}
      }
    }

    if (!loaded || !cache[coll]?.length) {
      if (coll === "services") cache[coll] = DEFAULT_SERVICES;
      if (coll === "parts") cache[coll] = DEFAULT_PARTS;
      if (coll === "motors") cache[coll] = DEFAULT_MOTORS;
      if (coll === "accomplishments") cache[coll] = DEFAULT_ACCOMPLISHMENTS;
      localStorage.setItem(`rr_${coll}`, JSON.stringify(cache[coll]));
    }
  }

  // Load Bookings cache
  if (configured && db) {
    try {
      const bSnap = await withTimeout(getDocs(query(collection(db, "bookings"), orderBy("createdAt", "desc"))), 3500);
      if (bSnap) {
        cache.bookings = bSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        localStorage.setItem("rr_bookings", JSON.stringify(cache.bookings));
      }
    } catch (_) {}
  }
  if (!cache.bookings.length) {
    const localB = localStorage.getItem("rr_bookings");
    if (localB) {
      try { cache.bookings = JSON.parse(localB); } catch (_) {}
    }
    // Seed sample demo booking if empty
    if (!cache.bookings.length) {
      cache.bookings = [
        {
          id: "RR-DEMO01",
          bookingId: "RR-DEMO01",
          customer: "Juan Dela Cruz",
          phone: "0918 288 6282",
          email: "juan@gmail.com",
          bike: "Yamaha Aerox 155 V2",
          plate: "ABC 1234",
          service: "Ultrasonic Throttle Body Cleaning",
          turnaround: "Same Day (~1–2 hours)",
          baseLabor: 650,
          ownParts: "no",
          partsCost: 380,
          fitmentFee: 0,
          markup: 0,
          grossTotal: 1030,
          downpayment: 50,
          remainingBalance: 980,
          downpaymentMethod: "GCash",
          downpaymentRef: "102938475612",
          status: "In-Service",
          date: new Date().toISOString().split("T")[0],
          notes: "Ultrasonic cavitation throttle body cleaning on Bay #1. NGK Laser Iridium plug installed.",
          proofPhoto: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=800&q=80"
        }
      ];
    }
  }

  renderAll();
  populateBookingFormServices();
  populateShopPartsChecklist();
  calculateBookingPrice();
}

/* ==========================================================================
   5. PRACTICAL SHOP PRICING ENGINE (NO CONFUSING MULTIPLIERS / PERCENTAGES)
   ========================================================================== */
// Transparent Shop Pricing Breakdown:
// Customer-Supplied Parts: Total = Service Labor + Fitment/Handling Fee (₱50 flat fee)
// Shop-Supplied Parts:     Total = Service Labor + Catalog Part Price (Fitment included free)
// GCash Downpayment:       ₱50.00 standard reservation fee (100% credited to invoice)
function calculateBookingPrice() {
  const serviceSelect = $("#bookService");
  const ownPartsYes = $("#ownPartsYes");
  const isOwnParts = ownPartsYes && ownPartsYes.checked;

  const quoteBaseLabor = $("#quoteBaseLabor");
  const quotePartsCost = $("#quotePartsCost");
  const quoteMarkup = $("#quoteMarkup");
  const quoteMarkupRow = $("#quoteMarkupRow");
  const quoteGrossTotal = $("#quoteGrossTotal");
  const quoteDownpayment = $("#quoteDownpayment");
  const quoteBalance = $("#quoteBalance");
  const quoteCategoryBadge = $("#quoteCategoryBadge");

  // Determine selected service base price and turnaround time
  let basePrice = 650;
  let turnaround = "Same Day (~2–3 hours)";
  if (serviceSelect && serviceSelect.value) {
    const found = cache.services.find((s) => s.title === serviceSelect.value);
    if (found) {
      if (found.price) basePrice = Number(found.price);
      if (found.turnaround) turnaround = found.turnaround;
    }
  }

  let partsTotal = 0;
  let fitmentFee = 0;
  let grossTotal = 0;

  if (isOwnParts) {
    // Customer-Supplied Parts: Total = Service Labor + Fitment/Handling Fee (₱50 flat fee)
    fitmentFee = 50;
    partsTotal = 0;
    grossTotal = basePrice + fitmentFee;
    if (quoteCategoryBadge) quoteCategoryBadge.textContent = "Customer Supplies Parts (₱50 Flat Fitment Fee)";
    if (quoteMarkupRow) quoteMarkupRow.querySelector("span:first-child").textContent = "Fitment & Handling Fee:";
  } else {
    // Shop supplies parts: sum selected checked parts
    $$(".shop-part-chk:checked").forEach((chk) => {
      partsTotal += Number(chk.dataset.price || 0);
    });

    // Shop-Supplied Parts: Total = Service Labor + Catalog Part Price (Fitment included free)
    fitmentFee = 0;
    grossTotal = basePrice + partsTotal;
    if (quoteCategoryBadge) quoteCategoryBadge.textContent = "Shop Supplies Parts (Fitment Included)";
    if (quoteMarkupRow) quoteMarkupRow.querySelector("span:first-child").textContent = "Fitment & Handling Fee:";
  }

  // Consistent ₱50.00 GCash reservation deposit
  const standardDownpayment = Math.min(50, grossTotal);
  const remainingBalance = Math.max(0, grossTotal - standardDownpayment);

  if (quoteBaseLabor) quoteBaseLabor.textContent = peso(basePrice);
  if (quotePartsCost) quotePartsCost.textContent = isOwnParts ? "₱0.00 (Customer-Supplied)" : peso(partsTotal);
  if (quoteMarkup) quoteMarkup.textContent = fitmentFee > 0 ? "+" + peso(fitmentFee) : "₱0.00 (Free w/ Shop Parts)";
  if (quoteGrossTotal) quoteGrossTotal.textContent = peso(grossTotal);
  if (quoteDownpayment) quoteDownpayment.textContent = "-" + peso(standardDownpayment);
  if (quoteBalance) quoteBalance.textContent = peso(remainingBalance);

  return {
    baseLabor: basePrice,
    partsCost: partsTotal,
    fitmentFee: fitmentFee,
    markup: fitmentFee,
    grossTotal: grossTotal,
    downpayment: standardDownpayment,
    remainingBalance: remainingBalance,
    isOwnParts: isOwnParts,
    turnaround: turnaround
  };
}

// Populate Services dropdown in Booking Form
function populateBookingFormServices() {
  const select = $("#bookService");
  if (!select) return;
  const currVal = select.value;
  select.innerHTML = cache.services
    .map((s) => `<option value="${esc(s.title)}" ${s.title === currVal ? "selected" : ""}>${esc(s.title)} (${peso(s.price)}${s.turnaround ? ` • ${esc(s.turnaround)}` : ""})</option>`)
    .join("");
}

// Populate Shop Parts checklist in Booking Form (Syncs with in-stock catalog parts)
function populateShopPartsChecklist() {
  const container = $("#shopPartsChecklist");
  if (!container) return;

  const defaultConsumables = [
    { title: "Motul 7100 10W-40 Fully Synthetic Oil (1L)", price: 580 },
    { title: "K&N High-Flow Engine Oil Filter", price: 320 },
    { title: "NGK Laser Iridium Spark Plug", price: 380 },
    { title: "Bando Heavy Duty CVT Drive Belt", price: 850 },
    { title: "Koso Teflon Flyball Rollers (Set)", price: 450 },
    { title: "DOT 4 Synthetic Brake Fluid Flush", price: 180 },
    { title: "Engine Coolant 50/50 Premix (1L)", price: 250 }
  ];

  // Also include in-stock parts from catalog cache
  const inStockCatalog = (cache.parts || [])
    .filter((p) => p.stock !== "Sold Out" && p.stock !== "Out of Stock" && p.price > 0)
    .map((p) => ({ title: `${p.title}${p.fitment ? ` (${p.fitment})` : ""}`, price: Number(p.price) }));

  const seen = new Set();
  const combinedParts = [...defaultConsumables, ...inStockCatalog].filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  container.innerHTML = combinedParts
    .map(
      (p) => `
        <div class="shop-part-item">
          <label>
            <input type="checkbox" class="shop-part-chk" value="${esc(p.title)}" data-price="${p.price}">
            <span>${esc(p.title)}</span>
          </label>
          <span class="shop-part-price">${peso(p.price)}</span>
        </div>
      `
    )
    .join("");

  $$(".shop-part-chk", container).forEach((chk) => {
    chk.onchange = calculateBookingPrice;
  });
}

// Setup radio toggles for Customer-Supplied vs Shop Parts
const ownPartsYesRadio = $("#ownPartsYes");
const ownPartsNoRadio = $("#ownPartsNo");
const labelOwnPartsYes = $("#labelOwnPartsYes");
const labelOwnPartsNo = $("#labelOwnPartsNo");
const ownPartsDetailsBox = $("#ownPartsDetailsBox");
const shopPartsDetailsBox = $("#shopPartsDetailsBox");

function syncPartsToggle() {
  const isYes = ownPartsYesRadio && ownPartsYesRadio.checked;
  if (labelOwnPartsYes) labelOwnPartsYes.classList.toggle("active", isYes);
  if (labelOwnPartsNo) labelOwnPartsNo.classList.toggle("active", !isYes);
  if (ownPartsDetailsBox) ownPartsDetailsBox.classList.toggle("hidden", !isYes);
  if (shopPartsDetailsBox) shopPartsDetailsBox.classList.toggle("hidden", isYes);
  calculateBookingPrice();
}

if (ownPartsYesRadio) ownPartsYesRadio.onchange = syncPartsToggle;
if (ownPartsNoRadio) ownPartsNoRadio.onchange = syncPartsToggle;

const bookServiceSelect = $("#bookService");
if (bookServiceSelect) bookServiceSelect.onchange = calculateBookingPrice;

// Downpayment payment method toggles (GCash Express & Cash on Site)
const payGCashRadio = $("#payGCash");
const payCashRadio = $("#payCash");
const gcashBox = $("#gcashBox");
const cashWarningBox = $("#cashWarningBox");

function syncDownpaymentMethods() {
  if (gcashBox) gcashBox.classList.toggle("hidden", !payGCashRadio?.checked);
  if (cashWarningBox) cashWarningBox.classList.toggle("hidden", !payCashRadio?.checked);
}

if (payGCashRadio) payGCashRadio.onchange = syncDownpaymentMethods;
if (payCashRadio) payCashRadio.onchange = syncDownpaymentMethods;

/* ==========================================================================
   6. DYNAMIC UI RENDERING & IN-WEBSITE VISUAL CMS (NO CODE MODIFICATION NEEDED)
   ========================================================================== */
let isAdmin = false;

const badgeHTML = (stockStatus) => {
  if (!stockStatus) return "";
  let badgeClass = "b-in";
  if (stockStatus === "Low Stock") badgeClass = "b-low";
  if (stockStatus === "Pre-Order") badgeClass = "b-pre";
  if (stockStatus === "Out of Stock") badgeClass = "b-out";
  if (stockStatus === "Sold Out") badgeClass = "b-sold";
  if (stockStatus === "Approved") badgeClass = "b-appr";
  return `<span class="badge ${badgeClass}">${esc(stockStatus)}</span>`;
};

const renderCard = (item, kind) => {
  const isPart = kind === "parts";
  const isService = kind === "services";
  const isMotor = kind === "motors";
  const isSoldOut = isPart && (item.stock === "Sold Out" || item.stock === "Out of Stock");

  return `
    <article class="card ${isSoldOut ? "sold-out" : ""}" data-item-id="${esc(item.id)}" data-kind="${esc(kind)}">
      ${
        isAdmin
          ? `<div class="card-admin-overlay">
              <button type="button" class="card-cms-btn" data-cms-edit="${esc(item.id)}" data-cms-kind="${esc(kind)}" title="Edit in CMS">✏️ Edit</button>
              <button type="button" class="card-cms-btn del" data-cms-del="${esc(item.id)}" data-cms-kind="${esc(kind)}" title="Delete item">🗑️</button>
            </div>`
          : ""
      }
      <div class="card-media">
        ${isSoldOut ? `<span class="sold-out-banner">${esc(item.stock)}</span>` : ""}
        ${
          item.image
            ? `<img src="${esc(item.image)}" alt="${esc(item.title)}" class="card-img" loading="lazy">`
            : `<div class="card-placeholder">
                <span class="placeholder-icon">🏍️</span>
                <span>${isService ? "Workshop Service" : "Catalog Item"}</span>
              </div>`
        }
      </div>
      <div class="card-body">
        <div class="card-meta-row">
          <span class="card-category">${esc(item.category || "Service")}</span>
          ${isPart ? badgeHTML(item.stock) : ""}
        </div>
        <h3 class="card-title">${esc(item.title)}</h3>
        
        ${
          isPart && (item.subpart || item.fitment)
            ? `<div style="margin-bottom: 0.65rem;">
                ${item.subpart ? `<span class="badge" style="background:var(--surface2); border:1px solid var(--line);">${esc(item.subpart)}</span> ` : ""}
                ${item.fitment ? `<span class="part-fitment">🏍️ Fits: ${esc(item.fitment)}</span>` : ""}
              </div>`
            : ""
        }

        ${
          isService && item.turnaround
            ? `<div class="card-turnaround-badge" style="font-size:0.82rem; color:var(--gold); margin-bottom:0.6rem; display:flex; align-items:center; gap:0.4rem; font-weight:600;">
                <span>⏱️ Turnaround:</span> <span>${esc(item.turnaround)}</span>
              </div>`
            : ""
        }

        <p class="card-desc">${esc(item.description)}</p>
        
        <div class="card-footer-row">
          ${
            !isMotor
              ? `<div class="price ${isSoldOut ? "quote-only" : ""}">${peso(item.price)}</div>`
              : `<span class="card-category">Showcase Spec</span>`
          }
          ${
            isService
              ? `<button type="button" class="btn btn-outline sm" data-book-service="${esc(item.title)}">Book Bay</button>`
              : ""
          }
          ${
            isPart && isSoldOut
              ? `<span style="font-size:0.8rem; font-weight:700; color:var(--muted);">Restock Soon</span>`
              : ""
          }
        </div>
      </div>
    </article>
  `;
};

let activeServiceFilter = "all";
let activeCatTab = "motors";
let activePartFilter = "all";

function renderAll() {
  renderServices();
  renderCatalog();
  renderWork();
}

function renderServices() {
  const container = $("#servicesGrid");
  if (!container) return;

  const filtered = cache.services.filter((s) => {
    if (activeServiceFilter === "all") return true;
    return s.category === activeServiceFilter;
  });

  container.innerHTML = filtered.length
    ? filtered.map((s) => renderCard(s, "services")).join("")
    : `<p class="sub">No workshop services found matching filter.</p>`;
}

const servicePills = $("#serviceFilterPills");
if (servicePills) {
  servicePills.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill-btn");
    if (!btn) return;
    $$(".pill-btn", servicePills).forEach((b) => b.classList.toggle("active", b === btn));
    activeServiceFilter = btn.dataset.filter;
    renderServices();
  });
}

function renderCatalog() {
  const container = $("#catalogGrid");
  const partFilterPills = $("#partFilterPills");
  if (!container) return;

  if (partFilterPills) {
    partFilterPills.classList.toggle("hidden", activeCatTab !== "parts");
  }

  let list = cache[activeCatTab] || [];

  if (activeCatTab === "parts" && activePartFilter !== "all") {
    list = list.filter((p) => {
      const targetStr = `${p.category || ""} ${p.subpart || ""}`.toLowerCase();
      return targetStr.includes(activePartFilter.toLowerCase());
    });
  }

  container.innerHTML = list.length
    ? list.map((item) => renderCard(item, activeCatTab)).join("")
    : `<p class="sub">No catalog items matching this filter.</p>`;
}

const catTabs = $("#catTabs");
if (catTabs) {
  catTabs.onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    $$(".tab-btn", catTabs).forEach((b) => {
      b.classList.toggle("on", b === btn);
      b.setAttribute("aria-selected", String(b === btn));
    });
    activeCatTab = btn.dataset.c;
    renderCatalog();
  };
}

const partFilterPills = $("#partFilterPills");
if (partFilterPills) {
  partFilterPills.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill-btn");
    if (!btn) return;
    $$(".pill-btn", partFilterPills).forEach((b) => b.classList.toggle("active", b === btn));
    activePartFilter = btn.dataset.partFilter;
    renderCatalog();
  });
}

function renderWork() {
  const container = $("#workGrid");
  if (!container) return;

  const list = cache.accomplishments || [];
  if (!list.length) {
    container.innerHTML = `<p class="sub">Dyno runs and engine rebuilds will appear here.</p>`;
    return;
  }

  container.innerHTML = list
    .map((item) => {
      if (item.before && item.after) {
        return `
          <article class="card">
            ${
              isAdmin
                ? `<div class="card-admin-overlay">
                    <button type="button" class="card-cms-btn" data-cms-edit="${esc(item.id)}" data-cms-kind="accomplishments">✏️ Edit</button>
                    <button type="button" class="card-cms-btn del" data-cms-del="${esc(item.id)}" data-cms-kind="accomplishments">🗑️</button>
                  </div>`
                : ""
            }
            <div class="ba-box" style="--p: 50%;">
              <img src="${esc(item.after)}" alt="After work was performed" loading="lazy">
              <img class="top" src="${esc(item.before)}" alt="Before work was performed" loading="lazy">
              <div class="ba-divider">
                <div class="ba-handle" aria-hidden="true">&#9664;&#9654;</div>
              </div>
              <input type="range" min="0" max="100" value="50" aria-label="Compare before and after condition">
              <span class="ba-tag before">BEFORE</span>
              <span class="ba-tag after">AFTER</span>
            </div>
            <div class="card-body">
              <div class="card-meta-row">
                <span class="card-category">${esc(item.category || "Accomplishment")}</span>
              </div>
              <h3 class="card-title">${esc(item.title)}</h3>
              <p class="card-desc">${esc(item.description)}</p>
            </div>
          </article>
        `;
      } else {
        return renderCard(item, "accomplishments");
      }
    })
    .join("");

  $$(".ba-box").forEach((box) => {
    const range = $("input[type='range']", box);
    if (!range) return;
    const updateSlider = (val) => box.style.setProperty("--p", val + "%");
    range.addEventListener("input", () => updateSlider(range.value));
  });
}

// 1-Click Service Booking from Card
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-book-service]");
  if (btn) {
    const title = btn.dataset.bookService;
    const select = $("#bookService");
    if (select) {
      select.value = title;
      calculateBookingPrice();
    }
    const bookSection = $("#book");
    if (bookSection) bookSection.scrollIntoView({ behavior: "smooth" });
  }
});

// In-Website Visual CMS Direct Card Button Handlers (Edit & Delete on live site)
document.addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-cms-edit]");
  if (editBtn) {
    e.preventDefault();
    const kind = editBtn.dataset.cmsKind;
    const id = editBtn.dataset.cmsEdit;
    const item = (cache[kind] || []).find((i) => i.id === id);
    openCmsModal(kind, item);
    return;
  }

  const delBtn = e.target.closest("[data-cms-del]");
  if (delBtn) {
    e.preventDefault();
    const kind = delBtn.dataset.cmsKind;
    const id = delBtn.dataset.cmsDel;
    if (confirm(`Are you sure you want to delete this ${kind.slice(0, -1)} permanently from the live website?`)) {
      await deleteCmsItem(kind, id);
    }
    return;
  }
});

/* ==========================================================================
   7. SEARCH ENGINE (DEBOUNCED)
   ========================================================================== */
const searchInput = $("#search");
const searchResultsBox = $("#searchResults");
const searchGrid = $("#searchGrid");
const searchClearBtn = $("#searchClear");
const closeSearchBtn = $("#closeSearch");

function executeSearch() {
  if (!searchInput) return;
  const q = searchInput.value.trim().toLowerCase();

  if (searchClearBtn) searchClearBtn.classList.toggle("hidden", !q);

  if (!q) {
    if (searchResultsBox) searchResultsBox.classList.add("hidden");
    return;
  }

  const matches = [
    ["services", "services"],
    ["motors", "motors"],
    ["parts", "parts"]
  ].flatMap(([coll, kind]) =>
    (cache[coll] || [])
      .filter((i) => {
        const hay = `${i.title || ""} ${i.category || ""} ${i.subpart || ""} ${i.fitment || ""} ${i.description || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .map((i) => renderCard(i, kind))
  );

  if (searchGrid) {
    searchGrid.innerHTML = matches.length
      ? matches.join("")
      : `<p class="sub">No matching services, parts, or builds found for &ldquo;<b>${esc(q)}</b>&rdquo;.</p>`;
  }

  if (searchResultsBox) searchResultsBox.classList.remove("hidden");
}

if (searchInput) searchInput.addEventListener("input", debounce(executeSearch, 250));
if (searchClearBtn) {
  searchClearBtn.onclick = () => {
    searchInput.value = "";
    executeSearch();
    searchInput.focus();
  };
}
if (closeSearchBtn) {
  closeSearchBtn.onclick = () => {
    if (searchResultsBox) searchResultsBox.classList.add("hidden");
  };
}

/* ==========================================================================
   8. ADVANCED BOOKING WORKFLOW & DOWNPAYMENT SECURITY
   ========================================================================== */
function generateBookingId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let randomCode = "";
  for (let i = 0; i < 4; i++) {
    randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RR-${randomCode}`;
}

const bookDateInput = $("#bookDate");
if (bookDateInput) {
  const todayStr = new Date().toISOString().split("T")[0];
  bookDateInput.setAttribute("min", todayStr);
}

const bookForm = $("#bookForm");
if (bookForm) {
  bookForm.onsubmit = async (e) => {
    e.preventDefault();
    const out = $("#bookMsg");
    const submitBtn = $("#bookSubmitBtn");

    const formData = Object.fromEntries(new FormData(bookForm));
    const customerName = (formData.customer || "").trim();
    const rawPhone = (formData.phone || "").trim();
    const cleanPhone = rawPhone.replace(/[\s\-()]/g, "");
    const emailVal = (formData.email || "").trim();
    const bikeModel = (formData.bike || "").trim();
    const cleanPlate = (formData.plate || "").trim().toUpperCase();
    const dateVal = (formData.date || "").trim();

    if (customerName.length < 2) {
      msg(out, "Please enter your full name.", false);
      $("#bookCustomer")?.focus();
      return;
    }

    if (!/^09\d{9}$/.test(cleanPhone)) {
      msg(out, "Please enter a valid 11-digit Philippine mobile number starting with 09 (e.g. 0918 288 6282).", false);
      $("#bookPhone")?.focus();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      msg(out, "Please enter a valid email address for your booking confirmation.", false);
      $("#bookEmail")?.focus();
      return;
    }

    if (!bikeModel) {
      msg(out, "Please enter your motorcycle model.", false);
      $("#bookBike")?.focus();
      return;
    }

    if (!cleanPlate) {
      msg(out, "Please enter your motorcycle Plate Number or MV File No.", false);
      $("#bookPlate")?.focus();
      return;
    }

    const todayStr = new Date().toISOString().split("T")[0];
    if (!dateVal || dateVal < todayStr) {
      msg(out, "Please select today or a future appointment date.", false);
      $("#bookDate")?.focus();
      return;
    }

    const pricing = calculateBookingPrice();
    if (pricing.isOwnParts && !(formData.customerPartsList || "").trim()) {
      msg(out, "Please list the parts you are bringing for installation.", false);
      $("#customerPartsList")?.focus();
      return;
    }

    const policyCheck = $("#policyCheck");
    if (policyCheck && !policyCheck.checked) {
      msg(out, "Please accept the shop policies and 7-day warranty terms to proceed.", false);
      return;
    }

    // Downpayment Method & Proof Validation
    const payMethod = document.querySelector('input[name="downpaymentMethod"]:checked')?.value || "GCash";
    let paymentRef = "";
    let proofPhotoUrl = "";
    const proofFile = $("#proofFile")?.files[0];

    if (payMethod === "GCash") {
      paymentRef = ($("#gcashRef")?.value || "").replace(/\s+/g, "");
      if (!/^\d{9,13}$/.test(paymentRef)) {
        msg(out, "Please enter a valid 9 to 13-digit GCash Reference Number.", false);
        $("#gcashRef")?.focus();
        return;
      }
      if (!proofFile) {
        msg(out, "Please upload a screenshot or photo of your ₱50.00 GCash payment receipt.", false);
        $("#proofFile")?.focus();
        return;
      }
    } else if (payMethod === "Cash on Site") {
      const cashConfirm = $("#cashWarningConfirm");
      if (!cashConfirm || !cashConfirm.checked) {
        msg(out, "Please check the acknowledgment box to confirm you will arrive on time.", false);
        cashConfirm?.focus();
        return;
      }
      paymentRef = "CASH-ON-SITE";
    }

    const bookingId = generateBookingId();

    if (proofFile) {
      try {
        proofPhotoUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(proofFile);
        });
      } catch (_) {}
    }

    const bookingPayload = {
      bookingId: bookingId,
      customer: customerName,
      phone: rawPhone,
      email: emailVal,
      bike: bikeModel,
      plate: cleanPlate,
      service: formData.service,
      turnaround: pricing.turnaround,
      date: dateVal,
      ownParts: pricing.isOwnParts ? "yes" : "no",
      customerPartsList: pricing.isOwnParts ? (formData.customerPartsList || "").trim() : "",
      baseLabor: pricing.baseLabor,
      partsCost: pricing.partsCost,
      fitmentFee: pricing.fitmentFee,
      markup: pricing.fitmentFee,
      grossTotal: pricing.grossTotal,
      downpayment: pricing.downpayment,
      remainingBalance: pricing.remainingBalance,
      downpaymentMethod: payMethod,
      downpaymentRef: paymentRef,
      status: "Pending",
      notes: formData.notes ? formData.notes.trim() : "Standard service check",
      proofPhoto: proofPhotoUrl,
      createdAt: new Date().toISOString()
    };

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.querySelector(".btn-text").textContent = "Securing Bay & Verifying…";
      }

      // Save locally first for 100% reliability
      localStorage.setItem(`rr_booking_${bookingId}`, JSON.stringify(bookingPayload));
      localStorage.setItem(`rr_booking_${cleanPlate}`, JSON.stringify(bookingPayload));
      cache.bookings.unshift(bookingPayload);
      localStorage.setItem("rr_bookings", JSON.stringify(cache.bookings));

      // Sync to Firebase Firestore if configured
      if (configured && db) {
        try {
          await withTimeout(setDoc(doc(db, "bookings", bookingId), {
            ...bookingPayload,
            createdAt: serverTimestamp()
          }), 4000);
        } catch (dbErr) {
          console.warn("Firestore sync fallback to localStorage:", dbErr.message);
        }
      }

      // Email notification via EmailJS
      if (window.emailjs && emailjsConfig.publicKey && !emailjsConfig.publicKey.startsWith("PASTE")) {
        try {
          emailjs.init({ publicKey: emailjsConfig.publicKey });
          emailjs.send(emailjsConfig.serviceId, emailjsConfig.templateId, {
            to_email: emailjsConfig.adminEmail,
            booking_id: bookingId,
            customer: bookingPayload.customer,
            phone: bookingPayload.phone,
            email: bookingPayload.email,
            bike: bookingPayload.bike,
            plate: bookingPayload.plate,
            service: bookingPayload.service,
            date: bookingPayload.date,
            payment: `${payMethod} (Ref: ${paymentRef})`,
            notes: `Total: ₱${bookingPayload.grossTotal.toFixed(2)} | Downpayment: ₱${bookingPayload.downpayment.toFixed(2)} | Balance Due: ₱${bookingPayload.remainingBalance.toFixed(2)}`
          }).catch(console.error);
        } catch (_) {}
      }

      msg(
        out,
        `✓ SUCCESS! Your service reservation is secured. Booking ID: [${bookingId}]. A ₱50.00 GCash downpayment via ${payMethod} was recorded. Your remaining balance upon pickup is ₱${bookingPayload.remainingBalance.toFixed(2)}. Estimated Turnaround: ${bookingPayload.turnaround || "Same Day (~2–3 hours)"}.`,
        true
      );

      const trackInput = $("#trackInput");
      if (trackInput) trackInput.value = bookingId;

      bookForm.reset();
      syncPartsToggle();
      syncDownpaymentMethods();
      toast(`Reservation Secured! Booking ID: ${bookingId}`);

      // Auto-trigger tracker lookup for instant user gratification
      setTimeout(() => {
        if (trackForm) trackForm.dispatchEvent(new Event("submit", { cancelable: true }));
        const trackSec = $("#track");
        if (trackSec) trackSec.scrollIntoView({ behavior: "smooth" });
      }, 700);

    } catch (err) {
      console.error(err);
      msg(out, `Error: ${err.message || "Failed to submit reservation."}`, false);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.querySelector(".btn-text").textContent = "Confirm Reservation & Secure Bay";
      }
    }
  };
}

// Contact Form
const contactForm = $("#contactForm");
if (contactForm) {
  contactForm.onsubmit = async (e) => {
    e.preventDefault();
    const out = $("#contactMsg");
    const formData = Object.fromEntries(new FormData(contactForm));

    try {
      const messagePayload = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone || "Not provided",
        message: formData.message,
        read: false,
        createdAt: new Date().toISOString()
      };

      if (configured && db) {
        try {
          await addDoc(collection(db, "messages"), {
            ...messagePayload,
            createdAt: serverTimestamp()
          });
        } catch (_) {}
      }

      msg(out, "Thank you! Your inquiry was delivered to R.R. Motorcycle Shop technicians.", true);
      contactForm.reset();
      toast("Message sent!");
    } catch (err) {
      msg(out, err.message, false);
    }
  };
}

/* ==========================================================================
   9. REAL-TIME SERVICE STATUS TRACKER (5-STAGE APPROVAL WORKFLOW)
   ========================================================================== */
const trackForm = $("#trackForm");
const trackInput = $("#trackInput");
const trackOut = $("#trackOut");

document.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip-btn");
  if (chip && trackInput) {
    trackInput.value = chip.dataset.val;
    if (trackForm) trackForm.dispatchEvent(new Event("submit", { cancelable: true }));
  }
});

if (trackForm) {
  trackForm.onsubmit = async (e) => {
    e.preventDefault();
    const queryVal = (trackInput.value || "").trim().toUpperCase();
    if (!queryVal) return;

    trackOut.innerHTML = `
      <div class="track-placeholder">
        <p>Checking shop records for "${esc(queryVal)}"…</p>
      </div>
    `;

    try {
      let bookingData = null;

      // 1. Check in-memory/localStorage cache
      bookingData = cache.bookings.find(
        (b) => (b.bookingId || "").toUpperCase() === queryVal || (b.plate || "").toUpperCase() === queryVal
      );

      if (!bookingData) {
        const local = localStorage.getItem(`rr_booking_${queryVal}`);
        if (local) bookingData = JSON.parse(local);
      }

      // 2. Query Firestore if configured
      if (!bookingData && configured && db) {
        try {
          const directDoc = await withTimeout(getDoc(doc(db, "bookings", queryVal)), 3000);
          if (directDoc && directDoc.exists()) bookingData = directDoc.data();
        } catch (_) {}

        if (!bookingData) {
          try {
            const plateQuery = query(collection(db, "bookings"), where("plate", "==", queryVal));
            const snap = await withTimeout(getDocs(plateQuery), 3000);
            if (snap && !snap.empty) bookingData = snap.docs[0].data();
          } catch (_) {}
        }
      }

      // Demo fallback mock
      if (!bookingData && (queryVal === "RR-DEMO01" || queryVal === "ABC 1234" || queryVal === "ZX-4RR-99")) {
        bookingData = {
          bookingId: queryVal,
          customer: "Juan Dela Cruz",
          phone: "0918 288 6282",
          email: "juan@gmail.com",
          bike: queryVal === "ZX-4RR-99" ? "Kawasaki Ninja ZX-4RR" : "Yamaha Aerox 155 V2",
          plate: queryVal === "ZX-4RR-99" ? "ZX-4RR-99" : "ABC 1234",
          service: "Stock ECU Remapping",
          turnaround: "1 Day (~24 hours)",
          date: new Date().toISOString().split("T")[0],
          ownParts: "no",
          baseLabor: 3500,
          partsCost: 1250,
          fitmentFee: 0,
          markup: 0,
          grossTotal: 4750,
          downpayment: 50,
          remainingBalance: 4700,
          downpaymentMethod: "GCash",
          downpaymentRef: "102938475612",
          status: "In-Service",
          notes: "ECU reflashed with optimized Philippine fuel ignition curve; Dyno benchmark in progress on Bay #1.",
          proofPhoto: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=800&q=80"
        };
      }

      if (!bookingData) {
        trackOut.innerHTML = `
          <div class="track-placeholder">
            <span style="font-size: 2.2rem;">⚠️</span>
            <p style="color: var(--danger); font-weight: 700;">No active reservation found for "${esc(queryVal)}".</p>
            <p class="sub" style="font-size: 0.85rem;">Please check your Booking ID or Plate Number. Try demo chips <b>RR-DEMO01</b> or <b>ABC 1234</b>.</p>
          </div>
        `;
        return;
      }

      const currentStatus = bookingData.status || "Pending";
      const turnaroundTime = bookingData.turnaround || (cache.services.find((s) => s.title === bookingData.service)?.turnaround) || "Same Day (~2–3 hours)";

      let statusGuidance = "";
      let statusBadgeClass = "b-low";
      let statusIcon = "⏳";

      if (currentStatus === "Pending") {
        statusGuidance = "⏳ Reservation Received: Bay allocation and ₱50.00 GCash deposit verification pending.";
        statusBadgeClass = "b-low";
        statusIcon = "⏳";
      } else if (currentStatus === "Approved") {
        statusGuidance = "✓ Bay Reserved: Slot confirmed. Please bring your motorcycle to our Lag-on shop at your scheduled date.";
        statusBadgeClass = "b-in";
        statusIcon = "✓";
      } else if (currentStatus === "In-Service") {
        statusGuidance = "🔧 In Workshop: Our mechanics are actively working on your motorcycle on the service lift.";
        statusBadgeClass = "b-gold";
        statusIcon = "🔧";
      } else if (currentStatus === "Ready for Pick-Up") {
        statusGuidance = "🏁 Ready for Pick-Up: All procedures and diagnostic checks completed. Please claim your unit.";
        statusBadgeClass = "b-appr";
        statusIcon = "🏁";
      } else if (currentStatus === "Completed") {
        statusGuidance = "✓ Completed & Released: Service finalized and motorcycle released. 7-day workmanship warranty active.";
        statusBadgeClass = "b-appr";
        statusIcon = "✓";
      }

      const baseLabor = Number(bookingData.baseLabor || 650);
      const partsCost = Number(bookingData.partsCost || 0);
      const fitmentFee = Number(bookingData.fitmentFee !== undefined ? bookingData.fitmentFee : (bookingData.markup || 0));
      const grossTotal = Number(bookingData.grossTotal || (baseLabor + partsCost + fitmentFee));
      const downpayment = Number(bookingData.downpayment || 50);
      const remainingBalance = Number(bookingData.remainingBalance !== undefined ? bookingData.remainingBalance : (grossTotal - downpayment));

      const statusIndexMap = {
        "Pending": 0,
        "Approved": 1,
        "In-Service": 2,
        "Ready for Pick-Up": 3,
        "Completed": 4
      };
      const currentIdx = statusIndexMap[currentStatus] ?? 0;
      const bookedDateLabel = bookingData.date || "Scheduled";

      const milestones = [
        {
          title: "Reservation Received & Verified",
          desc: bookingData.downpaymentMethod === "Cash on Site" ? "Cash on Site booking scheduled" : "₱50.00 GCash Deposit Confirmed",
          time: bookedDateLabel
        },
        {
          title: "Motorcycle Checked-in at Bay #1",
          desc: "Brgy. Lag-on, Daet Workshop",
          time: currentIdx >= 1 ? "Confirmed" : "Pending"
        },
        {
          title: "Active Servicing & Diagnostics on Lift",
          desc: esc(bookingData.service || "Workshop Service"),
          time: currentIdx >= 2 ? "In Progress" : "Queued"
        },
        {
          title: "Final Multi-Point Safety Inspection",
          desc: "Road test & mechanic quality check",
          time: currentIdx >= 3 ? "Passed" : "Waiting"
        },
        {
          title: "Ready for Pick-Up & Release",
          desc: "7-day workmanship warranty active upon release",
          time: currentIdx >= 4 ? "Released" : "Estimated: " + esc(turnaroundTime)
        }
      ];

      trackOut.innerHTML = `
        <div class="track-result-card">
          <div class="plate-header-row">
            <div class="ph-plate" title="Philippine Vehicle Registration">
              <span class="ph-plate-band">PILIPINAS &bull; REG</span>
              <span class="ph-plate-number">${esc(bookingData.plate || "NO PLATE")}</span>
            </div>
            <div class="booking-ref-badge">
              ID: ${esc(bookingData.bookingId || "RR-SAMPLE")}
            </div>
          </div>

          <!-- J&T Express-Style Estimated Turnaround & Milestone Timeline -->
          <div class="tracker-turnaround-card">
            <div class="turnaround-top-row">
              <div class="turnaround-meta">
                <span class="turnaround-eyebrow">Estimated Completion Time</span>
                <div class="turnaround-time-val">⏱️ ${esc(turnaroundTime)}</div>
              </div>
              <div class="turnaround-status-badge ${statusBadgeClass}">
                ${statusIcon} ${esc(currentStatus)}
              </div>
            </div>

            <div class="turnaround-metrics-grid">
              <div class="turnaround-metric-item">
                <span class="m-label">Scheduled Date</span>
                <span class="m-val">📅 ${esc(bookingData.date || "Scheduled Today")}</span>
              </div>
              <div class="turnaround-metric-item">
                <span class="m-label">Workshop Bay</span>
                <span class="m-val">🔧 Bay #1 (Lag-on Shop)</span>
              </div>
              <div class="turnaround-metric-item">
                <span class="m-label">Shop Location</span>
                <span class="m-val">📍 Brgy. Lag-on, Daet</span>
              </div>
            </div>

            <div class="turnaround-guidance-box" style="border-left: 4px solid ${
              currentStatus === "Approved" ? "var(--teal)" : currentStatus === "In-Service" ? "var(--gold)" : currentStatus === "Completed" ? "var(--success)" : "var(--red)"
            };">
              <strong class="guidance-title">Current Workshop Status:</strong>
              <p class="guidance-text">${esc(statusGuidance)}</p>
            </div>
          </div>

          <div class="tracker-timeline" aria-label="Service Milestone Timeline">
            ${milestones.map((m, idx) => {
              const stateCls = idx < currentIdx ? "done" : idx === currentIdx ? "current" : "";
              return `
                <div class="timeline-step ${stateCls}">
                  <span class="timeline-node" aria-hidden="true"></span>
                  <div class="timeline-head">
                    <span class="timeline-title">${m.title}</span>
                    <span class="timeline-time">${m.time}</span>
                  </div>
                  <p class="timeline-desc">${m.desc}</p>
                </div>
              `;
            }).join("")}
          </div>

          <div class="track-details-list">
            <div class="track-detail-item">
              <span>Customer:</span>
              <span>${esc(bookingData.customer || "Valued Rider")}</span>
            </div>
            <div class="track-detail-item">
              <span>Motorcycle:</span>
              <span>${esc(bookingData.bike || "Bike")}</span>
            </div>
            <div class="track-detail-item">
              <span>Service Booked:</span>
              <span>${esc(bookingData.service || "General Service")}</span>
            </div>
            <div class="track-detail-item">
              <span>Parts Strategy:</span>
              <span>${bookingData.ownParts === "yes" ? "Client-Supplied (₱50 Flat Fitment)" : "Shop-Supplied Genuine Parts"}</span>
            </div>
            <div class="track-detail-item">
              <span>Base Service Labor:</span>
              <span>${peso(baseLabor)}</span>
            </div>
            <div class="track-detail-item">
              <span>Parts &amp; Consumables:</span>
              <span>${bookingData.ownParts === "yes" ? "₱0.00 (Customer)" : peso(partsCost)}</span>
            </div>
            <div class="track-detail-item">
              <span>Fitment / Handling Fee:</span>
              <span>${fitmentFee > 0 ? "+" + peso(fitmentFee) : "₱0.00 (Included)"}</span>
            </div>
            <div class="track-detail-item">
              <span>Gross Estimated Total:</span>
              <span style="font-weight:700;">${peso(grossTotal)}</span>
            </div>
            <div class="track-detail-item">
              <span>Reservation Deposit:</span>
              <span style="color: var(--teal); font-weight:700;">-${peso(downpayment)} (${esc(bookingData.downpaymentMethod || "GCash")})</span>
            </div>
            <div class="track-detail-item">
              <span>Remaining Balance Upon Pickup:</span>
              <span style="color: var(--gold); font-weight:700; font-size: 1.05rem;">${peso(remainingBalance)}</span>
            </div>
            <div class="track-detail-item" style="grid-column: 1 / -1;">
              <span>Technician Remarks:</span>
              <span style="color: var(--gold);">${esc(bookingData.notes || "Standard multi-point safety inspection.")}</span>
            </div>
          </div>

          ${
            bookingData.proofPhoto
              ? `<div class="tracker-proof-card">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <span class="rec-label">📸 PROOF / DIAGNOSTIC PHOTO:</span>
                    <span class="badge b-in">Attached</span>
                  </div>
                  <img src="${esc(bookingData.proofPhoto)}" alt="Repair Proof" class="tracker-proof-img">
                  ${bookingData.notes ? `<p style="font-size:0.85rem; color:var(--text); margin:0.4rem 0 0;"><b>Remarks:</b> ${esc(bookingData.notes)}</p>` : ""}
                </div>`
              : ""
          }
        </div>
      `;

    } catch (err) {
      console.error(err);
      trackOut.innerHTML = `<div class="form-alert err">Error loading tracker data: ${esc(err.message)}</div>`;
    }
  };
}

/* ==========================================================================
   9. SHOP BUSINESS & OPERATIONS ANALYTICS DASHBOARD
   ========================================================================== */
let activeAdminTab = "analytics";
let analyticsTimeframe = "monthly";

function showAdminScreen(initialTab = "analytics") {
  const adminScreen = $("#adminScreen");
  const mainWrapper = $("#mainWrapper");
  const sidebarEl = $("#sidebar");
  const mobileTopbar = $(".mobile-topbar");
  const adminCmsBar = $("#adminCmsBar");

  if (adminScreen) adminScreen.classList.remove("hidden");
  if (mainWrapper) mainWrapper.style.display = "none";
  if (sidebarEl) sidebarEl.style.display = "none";
  if (mobileTopbar) mobileTopbar.style.display = "none";
  if (adminCmsBar) adminCmsBar.classList.add("hidden");

  document.body.style.overflow = "hidden";
  renderAdminKpis();
  openAdminTab(initialTab);
}

function hideAdminScreen() {
  const adminScreen = $("#adminScreen");
  const mainWrapper = $("#mainWrapper");
  const sidebarEl = $("#sidebar");
  const mobileTopbar = $(".mobile-topbar");
  const adminCmsBar = $("#adminCmsBar");

  if (adminScreen) adminScreen.classList.add("hidden");
  if (mainWrapper) mainWrapper.style.display = "";
  if (sidebarEl) sidebarEl.style.display = "";
  if (mobileTopbar) mobileTopbar.style.display = "";
  if (adminCmsBar && isAdmin) adminCmsBar.classList.remove("hidden");

  document.body.style.overflow = "";
}

function renderAdminKpis() {
  const kpiRow = $("#adminKpiRow");
  const sideStats = $("#adminSidebarStats");
  const bookings = cache.bookings || [];

  // Completed Revenue
  const completedJobs = bookings.filter((b) => b.status === "Completed");
  const totalRevenue = completedJobs.reduce((sum, b) => sum + (Number(b.grossTotal) || 0), 0);
  const pendingCount = bookings.filter((b) => (b.status || "Pending") === "Pending").length;
  const inServiceCount = bookings.filter((b) => b.status === "In-Service").length;
  const totalParts = (cache.parts || []).length;
  const inStockParts = (cache.parts || []).filter((p) => p.stock === "In Stock").length;

  if (kpiRow) {
    kpiRow.innerHTML = `
      <div class="admin-kpi-card" style="--kpi-accent: var(--gold);">
        <div class="admin-kpi-value">${peso(totalRevenue)}</div>
        <div class="admin-kpi-label">Completed Service Revenue</div>
        <div class="admin-kpi-sub">${completedJobs.length} Released Units</div>
      </div>
      <div class="admin-kpi-card" style="--kpi-accent: var(--danger);">
        <div class="admin-kpi-value">${pendingCount}</div>
        <div class="admin-kpi-label">Pending Bay Approvals</div>
        <div class="admin-kpi-sub">Awaiting Verification</div>
      </div>
      <div class="admin-kpi-card" style="--kpi-accent: var(--teal);">
        <div class="admin-kpi-value">${inServiceCount}</div>
        <div class="admin-kpi-label">Active Bay Jobs</div>
        <div class="admin-kpi-sub">Mechanics On Lift</div>
      </div>
      <div class="admin-kpi-card" style="--kpi-accent: var(--info);">
        <div class="admin-kpi-value">${inStockParts} / ${totalParts}</div>
        <div class="admin-kpi-label">Inventory Health</div>
        <div class="admin-kpi-sub">${totalParts ? Math.round((inStockParts / totalParts) * 100) : 0}% Active In Stock</div>
      </div>
    `;
  }

  // Sidebar badges & quick stats
  const bBadge = $("#adminBadgeBookings");
  if (bBadge) {
    bBadge.textContent = pendingCount;
    bBadge.classList.toggle("hidden", pendingCount === 0);
  }

  if (sideStats) {
    sideStats.innerHTML = `
      <div style="margin-bottom: 0.4rem;">
        <span style="color: var(--gold); font-weight: 700;">${pendingCount}</span> Bay Approvals Pending
      </div>
      <div style="margin-bottom: 0.4rem;">
        <span style="color: #ffffff; font-weight: 700;">${bookings.length}</span> Total Booking Records
      </div>
      <div>
        <span style="color: var(--teal); font-weight: 700;">${(cache.parts || []).length}</span> Catalog Items Listed
      </div>
    `;
  }
}

function openAdminTab(tabName) {
  activeAdminTab = tabName;
  $$(".admin-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.t === tabName);
  });

  const body = $("#adminBody");
  if (!body) return;

  renderAdminKpis();

  if (tabName === "analytics") {
    renderAnalyticsPanel();
  } else if (tabName === "bookings") {
    renderAdminBookingsView();
  } else if (tabName === "cms") {
    renderAdminCmsManagerView();
  } else if (tabName === "messages") {
    renderAdminMessagesView();
  }
}

function renderAnalyticsPanel() {
  const body = $("#adminBody");
  if (!body) return;

  const bookings = cache.bookings || [];
  const completedJobs = bookings.filter((b) => b.status === "Completed");

  // Revenue Breakdown
  const laborRevenue = completedJobs.reduce((s, b) => s + (Number(b.baseLabor) || 0), 0);
  const partsRevenue = completedJobs.reduce((s, b) => s + (Number(b.partsCost) || 0), 0);
  const fitmentRevenue = completedJobs.reduce((s, b) => s + (Number(b.fitmentFee !== undefined ? b.fitmentFee : (b.markup || 0)) || 0), 0);
  const grossCompleted = laborRevenue + partsRevenue + fitmentRevenue;
  const maxRevCategory = Math.max(laborRevenue, partsRevenue, fitmentRevenue, 1);

  // Booking Status Distribution
  const statusCounts = {
    "Pending": 0,
    "Approved": 0,
    "In-Service": 0,
    "Ready for Pick-Up": 0,
    "Completed": 0
  };
  bookings.forEach((b) => {
    const st = b.status || "Pending";
    if (statusCounts[st] !== undefined) statusCounts[st]++;
  });
  const maxStatusCount = Math.max(...Object.values(statusCounts), 1);

  // Inventory Health Metrics
  const stockCounts = {
    "In Stock": 0,
    "Low Stock": 0,
    "Pre-Order": 0,
    "Out of Stock": 0,
    "Sold Out": 0
  };
  const partsList = cache.parts || [];
  partsList.forEach((p) => {
    const st = p.stock || "In Stock";
    if (stockCounts[st] !== undefined) stockCounts[st]++;
  });

  // Most Requested Services Leaderboard
  const serviceCounts = {};
  bookings.forEach((b) => {
    const sName = b.service || "Ultrasonic Throttle Body Cleaning";
    serviceCounts[sName] = (serviceCounts[sName] || 0) + 1;
  });
  (cache.services || []).forEach((s) => {
    if (!serviceCounts[s.title]) serviceCounts[s.title] = 1;
  });
  const sortedServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]);
  const maxSvcCount = sortedServices[0] ? sortedServices[0][1] : 1;

  const statusClassMap = {
    "Pending": "pending",
    "Approved": "approved",
    "In-Service": "in-service",
    "Ready for Pick-Up": "ready",
    "Completed": "completed"
  };

  const badgeClassMap = {
    "In Stock": "b-in",
    "Low Stock": "b-low",
    "Pre-Order": "b-pre",
    "Out of Stock": "b-out",
    "Sold Out": "b-sold"
  };

  body.innerHTML = `
    <div class="admin-section-header">
      <div>
        <span class="admin-section-title">Business Analytics &amp; Operations Dashboard</span>
        <p class="sub" style="margin: 0.25rem 0 0; font-size: 0.88rem;">Live financial breakdown, bay cycle metrics, and parts inventory health.</p>
      </div>
      <div style="display:flex; gap:0.5rem; align-items:center;">
        <span class="badge b-in">Daet Shop Active</span>
      </div>
    </div>

    <div class="analytics-grid">
      <!-- 1. Revenue & Sales Breakdown (Labor vs Parts vs Fitment) -->
      <div class="analytics-card">
        <div class="analytics-card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Revenue &amp; Sales Breakdown
        </div>
        <div class="revenue-bar-row">
          <span class="revenue-bar-label">Labor Services</span>
          <div class="revenue-bar-track">
            <div class="revenue-bar-fill labor" style="width: ${Math.round((laborRevenue / maxRevCategory) * 100)}%;"></div>
          </div>
          <span class="revenue-bar-val">${peso(laborRevenue)}</span>
        </div>
        <div class="revenue-bar-row">
          <span class="revenue-bar-label">Parts &amp; Consumables</span>
          <div class="revenue-bar-track">
            <div class="revenue-bar-fill parts" style="width: ${Math.round((partsRevenue / maxRevCategory) * 100)}%;"></div>
          </div>
          <span class="revenue-bar-val">${peso(partsRevenue)}</span>
        </div>
        <div class="revenue-bar-row">
          <span class="revenue-bar-label">Fitment &amp; Handling</span>
          <div class="revenue-bar-track">
            <div class="revenue-bar-fill markup" style="width: ${Math.round((fitmentRevenue / maxRevCategory) * 100)}%;"></div>
          </div>
          <span class="revenue-bar-val">${peso(fitmentRevenue)}</span>
        </div>
        <div style="border-top: 1px solid var(--line); margin-top: 1rem; padding-top: 0.85rem; display: flex; justify-content: space-between; align-items: center;">
          <strong style="color: var(--muted); font-size: 0.85rem; text-transform: uppercase;">Total Gross Realized</strong>
          <strong style="font-family: var(--font-mono); font-size: 1.35rem; color: var(--gold);">${peso(grossCompleted)}</strong>
        </div>
      </div>

      <!-- 2. Booking Status Distribution -->
      <div class="analytics-card">
        <div class="analytics-card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Booking Status Distribution (${bookings.length} Total)
        </div>
        <div class="status-dist-row">
          ${Object.entries(statusCounts).map(([statusName, count]) => {
            const pct = Math.round((count / maxStatusCount) * 100);
            return `
              <div class="status-dist-item">
                <span class="status-dist-label">${esc(statusName)}</span>
                <div class="status-dist-bar">
                  <div class="status-dist-fill ${statusClassMap[statusName] || ''}" style="width: ${pct}%;"></div>
                </div>
                <span class="status-dist-count">${count}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <!-- 3. Parts Inventory Health Metrics Table -->
      <div class="analytics-card">
        <div class="analytics-card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          Inventory Stock Level Health
        </div>
        <table class="inventory-health-table">
          <thead>
            <tr>
              <th>Availability Status</th>
              <th>Item Count</th>
              <th>Catalog Share</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(stockCounts).map(([statusLabel, count]) => {
              const sharePct = partsList.length ? Math.round((count / partsList.length) * 100) : 0;
              return `
                <tr>
                  <td><span class="badge ${badgeClassMap[statusLabel] || ''}">${esc(statusLabel)}</span></td>
                  <td style="font-family: var(--font-mono); font-weight: 700; color: #ffffff;">${count} items</td>
                  <td style="color: var(--muted);">${sharePct}%</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>

      <!-- 4. Most Requested Services Leaderboard -->
      <div class="analytics-card">
        <div class="analytics-card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Most Requested Workshop Services
        </div>
        <div>
          ${sortedServices.slice(0, 5).map(([svcName, count]) => {
            const pct = Math.round((count / maxSvcCount) * 100);
            return `
              <div class="service-meter-item">
                <div class="service-meter-info">
                  <span style="font-weight: 600; color: #ffffff; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(svcName)}</span>
                  <span style="color: var(--gold); font-family: var(--font-mono);">${count} Bookings</span>
                </div>
                <div class="meter-track">
                  <div class="meter-fill" style="width: ${pct}%;"></div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   10. AUTHENTICATION & ADMIN WORKFLOW (PROOF UPLOADS & CMS CRUD)
   ========================================================================== */
const authBtn = $("#authBtn");
const adminBtn = $("#adminBtn");
const adminCmsBar = $("#adminCmsBar");
const loginModal = $("#loginModal");
const loginForm = $("#loginForm");
const forgotBtn = $("#forgotBtn");

// Admin Topbar Action Buttons
$("#adminBackToSiteBtn")?.addEventListener("click", hideAdminScreen);
$("#adminLogoutBtn2")?.addEventListener("click", async () => {
  if (auth && configured) {
    try { await signOut(auth); } catch (_) {}
  }
  isAdmin = false;
  hideAdminScreen();
  updateAdminState();
  toast("Signed out from Shop Administration.");
});

// Admin Sidebar Navigation Clicks
$$(".admin-nav-btn").forEach((btn) => {
  btn.onclick = () => openAdminTab(btn.dataset.t);
});

if (authBtn) {
  authBtn.onclick = () => {
    if (isAdmin || auth?.currentUser) {
      if (auth) signOut(auth).catch(() => {});
      isAdmin = false;
      hideAdminScreen();
      updateAdminState();
      toast("Admin signed out.");
    } else {
      loginModal?.showModal();
    }
  };
}

if (adminBtn) {
  adminBtn.onclick = () => {
    showAdminScreen("analytics");
  };
}

// Exit Admin Mode Button on floating bar
const exitAdminModeBtn = $("#exitAdminModeBtn");
if (exitAdminModeBtn) {
  exitAdminModeBtn.onclick = () => {
    if (auth) signOut(auth).catch(() => {});
    isAdmin = false;
    hideAdminScreen();
    updateAdminState();
    toast("Admin Mode Deactivated.");
  };
}

function updateAdminState() {
  if (adminBtn) adminBtn.classList.toggle("hidden", !isAdmin);
  if (adminCmsBar) adminCmsBar.classList.toggle("hidden", !isAdmin);
  if (authBtn) authBtn.textContent = isAdmin ? "Dashboard / Logout" : "Admin Login";
  $$(".admin-cms-btn").forEach((b) => b.classList.toggle("hidden", !isAdmin));

  // Update pending count in floating bar
  const pendingCountEl = $("#cmsPendingCount");
  if (pendingCountEl) {
    const pCount = (cache.bookings || []).filter((b) => (b.status || "Pending") === "Pending").length;
    pendingCountEl.textContent = pCount;
  }

  // Re-render UI to display in-place edit buttons
  renderAll();
  renderAdminKpis();
}

if (loginForm) {
  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const out = $("#loginMsg");
    const { email, password } = Object.fromEntries(new FormData(loginForm));

    try {
      if (configured && auth) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        // Fallback for demonstration / offline
        if (email.toLowerCase().includes("admin") || email.toLowerCase().includes("timmothy")) {
          isAdmin = true;
          updateAdminState();
          loginModal?.close();
          showAdminScreen("analytics");
          toast("Admin privileges unlocked — Welcome to Shop Management!");
          return;
        }
      }
      loginModal?.close();
      showAdminScreen("analytics");
      toast("Admin authentication successful!");
    } catch (err) {
      msg(out, "Authentication failed: " + err.message, false);
    }
  };
}

if (configured && auth) {
  onAuthStateChanged(auth, async (user) => {
    isAdmin = false;
    if (user) {
      try {
        const userDoc = await withTimeout(getDoc(doc(db, "users", user.uid)), 3000);
        isAdmin = (userDoc && userDoc.exists() && userDoc.data()?.role === "admin") || user.email === "timmothygerona@gmail.com";
      } catch (_) {
        isAdmin = user.email === "timmothygerona@gmail.com";
      }
    }
    updateAdminState();
  });
}

// Quick Header Buttons in CMS Bar
$("#quickAddServiceBtn")?.addEventListener("click", () => openCmsModal("services", null));
$("#quickAddPartBtn")?.addEventListener("click", () => openCmsModal("parts", null));
$("#cmsAddServiceHeadBtn")?.addEventListener("click", () => openCmsModal("services", null));
$("#cmsAddCatalogHeadBtn")?.addEventListener("click", () => openCmsModal("parts", null));
$("#cmsAddAccomplishBtn")?.addEventListener("click", () => openCmsModal("accomplishments", null));

$("#openAdminAnalyticsBtn")?.addEventListener("click", () => {
  showAdminScreen("analytics");
});
$("#openAdminBookingsBtn")?.addEventListener("click", () => {
  showAdminScreen("bookings");
});

// Bookings Management with 5-Stage Approval & Proof Upload
let activeBookingFilter = "all";

function renderAdminBookingsView() {
  const body = $("#adminBody");
  if (!body) return;

  const rows = cache.bookings || [];
  const pendingCount = rows.filter((b) => (b.status || "Pending") === "Pending").length;

  const filtered = rows.filter((b) => {
    if (activeBookingFilter === "all") return true;
    return (b.status || "Pending") === activeBookingFilter;
  });

  body.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
      <div class="service-filters" id="adminBFilters">
        <button class="pill-btn ${activeBookingFilter === "all" ? "active" : ""}" data-bf="all">All (${rows.length})</button>
        <button class="pill-btn ${activeBookingFilter === "Pending" ? "active" : ""}" data-bf="Pending" style="${pendingCount > 0 ? "border-color:var(--red); color:var(--red);" : ""}">Pending (${pendingCount})</button>
        <button class="pill-btn ${activeBookingFilter === "Approved" ? "active" : ""}" data-bf="Approved">Approved</button>
        <button class="pill-btn ${activeBookingFilter === "In-Service" ? "active" : ""}" data-bf="In-Service">In-Service</button>
        <button class="pill-btn ${activeBookingFilter === "Ready for Pick-Up" ? "active" : ""}" data-bf="Ready for Pick-Up">Ready</button>
        <button class="pill-btn ${activeBookingFilter === "Completed" ? "active" : ""}" data-bf="Completed">Completed</button>
      </div>
      <button type="button" class="btn btn-outline sm" id="refreshBookingsBtn">🔄 Sync Firestore</button>
    </div>

    <div class="scroll-table-container">
      <table>
        <thead>
          <tr>
            <th>Booking ID</th>
            <th>Customer &amp; Contact</th>
            <th>Motorcycle &amp; Plate</th>
            <th>Service &amp; Est. Turnaround</th>
            <th>Downpayment &amp; Balance</th>
            <th>Status Progression &amp; Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((b) => {
            const currentStatus = b.status || "Pending";
            const isPending = currentStatus === "Pending";
            const isApproved = currentStatus === "Approved";
            const isInService = currentStatus === "In-Service";
            const isReady = currentStatus === "Ready for Pick-Up";

            return `
              <tr>
                <td>
                  <b>${esc(b.bookingId || b.id)}</b>
                  ${isPending ? `<br><span class="badge b-out" style="font-size:0.7rem;">Needs Approval</span>` : ""}
                </td>
                <td>
                  <strong>${esc(b.customer)}</strong><br>
                  <small style="color:var(--muted);">${esc(b.phone)} &bull; ${esc(b.email)}</small>
                </td>
                <td>
                  ${esc(b.bike)}<br>
                  <span class="badge b-low">${esc(b.plate)}</span>
                </td>
                <td>
                  <b>${esc(b.service)}</b><br>
                  <small style="color:var(--gold);">⏱️ ${esc(b.turnaround || "Same Day (~2–3 hours)")}</small><br>
                  <small style="color:var(--muted);">${b.ownParts === "yes" ? "Client brings parts (₱50 fee)" : "Shop genuine parts"}</small>
                </td>
                <td>
                  <span style="color:var(--teal); font-weight:700;">DP: ${peso(b.downpayment || 50)}</span><br>
                  <span style="color:var(--gold); font-size:0.85rem;">Bal: ${peso(b.remainingBalance || 0)}</span>
                </td>
                <td>
                  <div class="admin-action-btn-group" style="margin-bottom: 0.4rem;">
                    ${isPending ? `<button type="button" class="btn-approve" data-quick-st="${esc(b.id || b.bookingId)}" data-target="Approved">✓ Approve</button>` : ""}
                    ${isApproved ? `<button type="button" class="btn-service" data-quick-st="${esc(b.id || b.bookingId)}" data-target="In-Service">🔧 In-Service</button>` : ""}
                    ${isInService ? `<button type="button" class="btn-ready" data-quick-st="${esc(b.id || b.bookingId)}" data-target="Ready for Pick-Up">🏁 Mark Ready</button>` : ""}
                    ${isReady ? `<button type="button" class="btn-complete" data-quick-st="${esc(b.id || b.bookingId)}" data-target="Completed">✓ Complete &amp; Release</button>` : ""}
                    <button type="button" class="btn-receipt-action" data-attach-proof="${esc(b.id || b.bookingId)}">📷 Proof</button>
                  </div>
                  <select data-st-change="${esc(b.id || b.bookingId)}" class="st" style="width:100%; font-size:0.82rem; padding:0.25rem 0.5rem;">
                    ${STATUSES.map((s) => `<option value="${s}" ${s === currentStatus ? "selected" : ""}>${s}</option>`).join("")}
                    <option value="Cancelled" ${currentStatus === "Cancelled" ? "selected" : ""}>Cancelled</option>
                  </select>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  // Filter clicks
  $$("[data-bf]", body).forEach((btn) => {
    btn.onclick = () => {
      activeBookingFilter = btn.dataset.bf;
      renderAdminBookingsView();
    };
  });

  // Quick Status Transition Button
  $$("[data-quick-st]", body).forEach((btn) => {
    btn.onclick = async () => {
      const bId = btn.dataset.quickSt;
      const targetStatus = btn.dataset.target;
      await updateBookingStatus(bId, targetStatus);
    };
  });

  // Dropdown Status Change
  $$("[data-st-change]", body).forEach((sel) => {
    sel.onchange = async () => {
      await updateBookingStatus(sel.dataset.stChange, sel.value);
    };
  });

  // Proof upload trigger
  $$("[data-attach-proof]", body).forEach((btn) => {
    btn.onclick = () => {
      const bId = btn.dataset.attachProof;
      const found = cache.bookings.find((b) => (b.id || b.bookingId) === bId);
      openProofModal(found);
    };
  });

  // Refresh
  const refreshBtn = $("#refreshBookingsBtn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      toast("Syncing with Firestore…");
      await loadAll();
      renderAdminBookingsView();
    };
  }
}

async function updateBookingStatus(bId, newStatus) {
  const found = cache.bookings.find((b) => (b.id || b.bookingId) === bId);
  if (found) {
    found.status = newStatus;
    localStorage.setItem(`rr_booking_${bId}`, JSON.stringify(found));
    localStorage.setItem("rr_bookings", JSON.stringify(cache.bookings));
  }

  if (configured && db) {
    try {
      await withTimeout(updateDoc(doc(db, "bookings", bId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      }), 3000);
    } catch (_) {}
  }

  toast(`Booking status updated to "${newStatus}"!`);
  updateAdminState();
  renderAdminBookingsView();
}

// Proof photo upload modal handler
const proofModal = $("#proofModal");
const proofForm = $("#proofForm");

function openProofModal(booking) {
  if (!booking || !proofModal) return;
  $("#proofBookingId").value = booking.id || booking.bookingId;
  $("#proofBookingLabel").textContent = `${booking.bookingId || booking.id} — ${booking.customer} (${booking.bike})`;
  $("#proofNotesInput").value = booking.notes || "";

  const previewBox = $("#proofPreviewBox");
  const previewImg = $("#proofPreviewImg");
  if (booking.proofPhoto && previewBox && previewImg) {
    previewImg.src = booking.proofPhoto;
    previewBox.style.display = "block";
  } else if (previewBox) {
    previewBox.style.display = "none";
  }

  proofModal.showModal();
}

if (proofForm) {
  proofForm.onsubmit = async (e) => {
    e.preventDefault();
    const bId = $("#proofBookingId").value;
    const file = $("#proofFileInput")?.files[0];
    const notes = $("#proofNotesInput").value.trim();
    const out = $("#proofMsg");

    try {
      let photoUrl = "";
      if (file) {
        photoUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
      }

      const found = cache.bookings.find((b) => (b.id || b.bookingId) === bId);
      if (found) {
        if (photoUrl) found.proofPhoto = photoUrl;
        if (notes) found.notes = notes;
        localStorage.setItem(`rr_booking_${bId}`, JSON.stringify(found));
        localStorage.setItem("rr_bookings", JSON.stringify(cache.bookings));
      }

      if (configured && db) {
        try {
          await withTimeout(updateDoc(doc(db, "bookings", bId), {
            proofPhoto: photoUrl || found?.proofPhoto || "",
            notes: notes
          }), 3500);
        } catch (_) {}
      }

      toast("Proof photo attached to booking!");
      proofModal.close();
      renderAdminBookingsView();
    } catch (err) {
      msg(out, err.message, false);
    }
  };
}

// Preview proof photo on file select
$("#proofFileInput")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      const previewBox = $("#proofPreviewBox");
      const previewImg = $("#proofPreviewImg");
      if (previewBox && previewImg) {
        previewImg.src = reader.result;
        previewBox.style.display = "block";
      }
    };
    reader.readAsDataURL(file);
  }
});

// Admin Visual CMS Manager View (Table of all services, parts, etc.)
let activeCmsTab = "services";

function renderAdminCmsManagerView() {
  const body = $("#adminBody");
  if (!body) return;

  const rows = cache[activeCmsTab] || [];

  body.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem; flex-wrap:wrap; gap:0.75rem;">
      <div class="tabs" id="adminCmsTabs">
        <button class="tab-btn ${activeCmsTab === "services" ? "on" : ""}" data-c="services">Services</button>
        <button class="tab-btn ${activeCmsTab === "parts" ? "on" : ""}" data-c="parts">Parts &amp; Accessories</button>
        <button class="tab-btn ${activeCmsTab === "motors" ? "on" : ""}" data-c="motors">Showcase Bikes</button>
        <button class="tab-btn ${activeCmsTab === "accomplishments" ? "on" : ""}" data-c="accomplishments">Accomplishments</button>
      </div>
      <button type="button" class="btn btn-primary sm" id="cmsAddNewBtn">+ Add New ${activeCmsTab.slice(0, -1)}</button>
    </div>

    <div class="scroll-table-container">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Category</th>
            ${activeCmsTab === "parts" ? "<th>Subpart &amp; Fitment</th><th>Stock</th>" : ""}
            ${activeCmsTab === "services" ? "<th>Base Labor</th><th>Est. Turnaround</th>" : activeCmsTab !== "motors" && activeCmsTab !== "accomplishments" ? "<th>Price</th>" : ""}
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((item) => `
            <tr>
              <td><b>${esc(item.title)}</b></td>
              <td>${esc(item.category || "-")}</td>
              ${
                activeCmsTab === "parts"
                  ? `<td><small style="color:var(--gold);">${esc(item.subpart || "-")}</small><br><span class="part-fitment">${esc(item.fitment || "Universal")}</span></td>
                     <td>${badgeHTML(item.stock)}</td>`
                  : ""
              }
              ${
                activeCmsTab === "services"
                  ? `<td><b>${peso(item.price)}</b></td>
                     <td><small style="color:var(--gold);">⏱️ ${esc(item.turnaround || "Same Day (~2–3 hours)")}</small></td>`
                  : activeCmsTab !== "motors" && activeCmsTab !== "accomplishments"
                  ? `<td>${peso(item.price)}</td>`
                  : ""
              }
              <td style="text-align:right; white-space:nowrap;">
                <button type="button" class="btn btn-outline sm" data-t-edit="${esc(item.id)}">Edit</button>
                <button type="button" class="btn btn-outline sm" data-t-del="${esc(item.id)}" style="border-color:var(--danger); color:var(--danger);">Delete</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  // Tab switcher
  $$("#adminCmsTabs button", body).forEach((b) => {
    b.onclick = () => {
      activeCmsTab = b.dataset.c;
      renderAdminCmsManagerView();
    };
  });

  $("#cmsAddNewBtn").onclick = () => openCmsModal(activeCmsTab, null);

  $$("[data-t-edit]", body).forEach((btn) => {
    btn.onclick = () => {
      const item = rows.find((r) => r.id === btn.dataset.tEdit);
      openCmsModal(activeCmsTab, item);
    };
  });

  $$("[data-t-del]", body).forEach((btn) => {
    btn.onclick = async () => {
      if (confirm(`Delete this ${activeCmsTab.slice(0, -1)} permanently?`)) {
        await deleteCmsItem(activeCmsTab, btn.dataset.tDel);
        renderAdminCmsManagerView();
      }
    };
  });
}

// Inquiries / Messages View
function renderAdminMessagesView() {
  const body = $("#adminBody");
  if (!body) return;
  body.innerHTML = `
    <div style="background:var(--surface2); padding:1rem; border-radius:var(--radius-sm); border:1px solid var(--line);">
      <p style="margin:0; font-size:0.9rem; color:var(--text);">Customer messages are forwarded to <b>${emailjsConfig.adminEmail}</b> and synced in real-time.</p>
    </div>
  `;
}

// Dynamic CMS Modal Opener (For Products, Parts, Services, Accomplishments)
let currentlyEditingItem = null;
let currentCmsKind = "services";

function openCmsModal(kind, item) {
  currentCmsKind = kind;
  currentlyEditingItem = item;

  const modal = $("#itemModal");
  const form = $("#itemForm");
  if (!modal || !form) return;

  form.reset();
  $("#itemTitle").textContent = (item ? "Edit " : "Create New ") + kind.slice(0, -1).toUpperCase();
  $("#itemInputKind").value = kind;

  if (item) {
    $("#itemInputTitle").value = item.title || "";
    $("#itemInputCategory").value = item.category || "";
    $("#itemInputSubpart").value = item.subpart || "";
    $("#itemInputFitment").value = item.fitment || "";
    $("#itemInputDesc").value = item.description || "";
    $("#itemInputPrice").value = item.price !== null && item.price !== undefined ? item.price : "";
    $("#itemInputStock").value = item.stock || "In Stock";
    const turnaroundEl = $("#itemInputTurnaround");
    if (turnaroundEl) turnaroundEl.value = item.turnaround || "Same Day (~2–3 hours)";
    $("#itemInputImg").value = item.image || "";
  } else {
    const turnaroundEl = $("#itemInputTurnaround");
    if (turnaroundEl) turnaroundEl.value = "Same Day (~2–3 hours)";
  }

  // Toggle field visibility depending on kind
  const isPart = kind === "parts";
  const isService = kind === "services";
  const isAccomplish = kind === "accomplishments";
  const isMotor = kind === "motors";

  $("#itemSubpartGroup")?.classList.toggle("hidden", !isPart);
  $("#itemFitmentGroup")?.classList.toggle("hidden", !isPart);
  $("#itemStockGroup")?.classList.toggle("hidden", !isPart);
  $("#itemTurnaroundGroup")?.classList.toggle("hidden", !isService);
  $("#itemPriceGroup")?.classList.toggle("hidden", isAccomplish || isMotor);
  $("#baGroup")?.classList.toggle("hidden", !isAccomplish);

  modal.showModal();
}

// CMS Form Submission Handler (Save/Edit Item)
const itemForm = $("#itemForm");
if (itemForm) {
  itemForm.onsubmit = async (e) => {
    e.preventDefault();
    const out = $("#itemMsg");
    const kind = $("#itemInputKind").value;
    const title = $("#itemInputTitle").value.trim();
    const category = $("#itemInputCategory").value.trim();
    const subpart = $("#itemInputSubpart").value.trim();
    const fitment = $("#itemInputFitment").value.trim();
    const description = $("#itemInputDesc").value.trim();
    const priceVal = $("#itemInputPrice").value;
    const price = priceVal !== "" ? Number(priceVal) : null;
    const stock = $("#itemInputStock").value;
    const turnaround = $("#itemInputTurnaround")?.value.trim() || (kind === "services" ? "Same Day (~2–3 hours)" : "");
    let imageUrl = $("#itemInputImg").value.trim();

    // Check file upload
    const file = $("#itemFileField")?.files[0];
    if (file) {
      try {
        imageUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
      } catch (_) {}
    }

    const payload = {
      title,
      category,
      subpart,
      fitment,
      description,
      price,
      stock,
      image: imageUrl
    };

    if (kind === "services") {
      payload.turnaround = turnaround;
    }

    try {
      if (currentlyEditingItem) {
        // Edit existing
        const itemId = currentlyEditingItem.id;
        const index = cache[kind].findIndex((i) => i.id === itemId);
        if (index !== -1) cache[kind][index] = { ...cache[kind][index], ...payload };

        if (configured && db) {
          try {
            await withTimeout(updateDoc(doc(db, kind, itemId), payload), 3500);
          } catch (_) {}
        }
        toast(`✓ ${title} updated successfully!`);
      } else {
        // Add new
        const newId = kind.slice(0, 1) + "_" + Date.now();
        const newItem = { id: newId, ...payload };
        cache[kind].unshift(newItem);

        if (configured && db) {
          try {
            await withTimeout(setDoc(doc(db, kind, newId), {
              ...payload,
              createdAt: serverTimestamp()
            }), 3500);
          } catch (_) {}
        }
        toast(`✓ New ${kind.slice(0, -1)} published to website!`);
      }

      // Persist to local cache and re-render
      localStorage.setItem(`rr_${kind}`, JSON.stringify(cache[kind]));
      renderAll();
      populateBookingFormServices();
      calculateBookingPrice();
      $("#itemModal").close();

      if (activeAdminTab === "cms") {
        renderAdminCmsManagerView();
      }
    } catch (err) {
      msg(out, "Could not save item: " + err.message, false);
    }
  };
}

// Delete CMS Item
async function deleteCmsItem(kind, id) {
  cache[kind] = cache[kind].filter((i) => i.id !== id);
  localStorage.setItem(`rr_${kind}`, JSON.stringify(cache[kind]));

  if (configured && db) {
    try {
      await withTimeout(deleteDoc(doc(db, kind, id)), 3000);
    } catch (_) {}
  }

  toast("Item removed from live website.");
  renderAll();
  populateBookingFormServices();
  calculateBookingPrice();
}

// Initialize and Kick Off
loadAll();
