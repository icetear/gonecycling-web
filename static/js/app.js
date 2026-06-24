// GoneCycling planner home page: map view + navbar/modal for the
// (end-to-end encrypted) sync. ES module; crypto/sync come in via the
// import map (see index.html), Bootstrap + MapLibre as global scripts.
import * as gcCrypto from "gc/crypto";
import { SyncClient } from "gc/sync";
import * as accounts from "gc/accounts";
import { pairingUri } from "gc/pairing";
import { TripsStore } from "gc/trips-store";
import { RidesStore } from "gc/rides-store";
import { Planner } from "gc/planner";
import { loadRoutingConfig, saveRoutingConfig } from "gc/routing";
import { loadPOIs, savePOIs } from "gc/poi";
import { buildBackup, applyBackup } from "gc/backup";
import { initialBasemap, basemapStyle, BasemapControl } from "gc/basemaps";
import { t, getLang, setLang, poiLabel } from "gc/i18n";
import { renderHelp } from "gc/help";

// ===========================================================================
//  Map
// ===========================================================================

// MapLibre expects [longitude, latitude]. Bielefeld ≈ 52.0302 N, 8.5325 E.
const BIELEFELD = [8.5325, 52.0302];

// Map background: freely selectable (layer switcher at bottom left), key-free.
const startBasemap = initialBasemap();
const map = new maplibregl.Map({ container: "map", style: basemapStyle(startBasemap), center: BIELEFELD, zoom: 12 });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
map.addControl(new BasemapControl(startBasemap.id), "bottom-left");

const geolocate = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true, timeout: 8000 },
  trackUserLocation: false,
  showUserLocation: true,
  fitBoundsOptions: { maxZoom: 14 },
});
map.addControl(geolocate, "top-right");
map.on("load", () => geolocate.trigger());

// ===========================================================================
//  Sync (navbar status + connect modal)
// ===========================================================================

const STORAGE_KEY = "gc.master_secret";
// API base incl. optional subpath (reverse proxy), set by the template
// (window.GC_BASE_PATH, e.g. "/gonecycling"). Empty = domain root.
const API_BASE = location.origin + (window.GC_BASE_PATH || "") + "/api/v1";

let client = null; // SyncClient, once (optionally) connected
let encKey = null; // CryptoKey (local), once connected
let account = null; // profile object, once signed in with a user account (otherwise null)

// Offline-first: create stores (localStorage) + planner IMMEDIATELY — planning
// works without a connection/sign-in. A sync is only activated additively on
// "Connect" (see connect()/disconnect).
const store = new TripsStore();
const ridesStore = new RidesStore();
const planner = new Planner(map);
planner.setStores(store, ridesStore);

// Since text inputs batch local saving (touchSoon, short typing pause),
// write all pending changes immediately when leaving/hiding the page
// (also covers the deferred sync push).
const flushStores = () => {
  store.flush().catch(() => {});
  ridesStore.flush().catch(() => {});
};
window.addEventListener("pagehide", flushStores);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushStores();
});

// ===========================================================================
//  Appearance (light/dark) + language (DE/EN)
// ===========================================================================

// — Theme: remembered choice (localStorage) otherwise system setting —
function resolvedTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("gc.theme");
  } catch {
    /* ignore */
  }
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme() {
  const th = resolvedTheme();
  document.documentElement.setAttribute("data-bs-theme", th);
  const btn = document.getElementById("btn-theme");
  if (btn) btn.textContent = th === "dark" ? "☀️" : "🌙";
}
applyTheme();
document.getElementById("btn-theme")?.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("gc.theme", next);
  } catch {
    /* ignore */
  }
  applyTheme();
});
// Follow system changes as long as no explicit choice has been made.
window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
  let saved = null;
  try {
    saved = localStorage.getItem("gc.theme");
  } catch {
    /* ignore */
  }
  if (saved !== "light" && saved !== "dark") applyTheme();
});

// — Language: translate static [data-i18n] texts + re-render dynamic views —
function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
}
function applyLang() {
  document.documentElement.lang = getLang();
  const btn = document.getElementById("btn-lang");
  if (btn) btn.textContent = getLang() === "de" ? "EN" : "DE";
  applyStaticTranslations();
  // Rebuild dynamically rendered views (planner).
  planner.renderList?.();
  planner.renderTours?.();
  planner.renderDetail?.();
  planner.renderTourDetail?.();
  planner._renderPoiBar?.();
  renderHelpBody(); // rebuild the open help modal in the new language
}

// — Help/info modal: inject content (bilingual) from gc/help —
function renderHelpBody() {
  const body = document.getElementById("help-body");
  if (body) body.innerHTML = renderHelp(getLang());
}
// Render on open (the initial fill is done by the following applyLang()).
document.getElementById("help-modal")?.addEventListener("show.bs.modal", renderHelpBody);

applyLang();
document.getElementById("btn-lang")?.addEventListener("click", () => {
  setLang(getLang() === "de" ? "en" : "de");
  applyLang();
  // Relabel the settings POI lists (quick targets/stage targets) so the
  // presets appear in the new language immediately while the modal is open. Deliberately
  // ONLY here (not in the startup `applyLang()`): the lists are only rendered when the
  // modal opens (`show.bs.modal`), and a call before the `escAttr` definition
  // would run into the TDZ during module load and abort the switcher.
  renderPoiList("poi-list", "quick");
  renderPoiList("snap-list", "snap");
});

const navDisconnected = document.getElementById("nav-disconnected");
const navConnected = document.getElementById("nav-connected");
const navAccount = document.getElementById("nav-account");
const navAccountName = document.getElementById("nav-account-name");
const navStatus = document.getElementById("nav-status");
const tokenInput = document.getElementById("token-input");
const connectError = document.getElementById("connect-error");
const connectModalEl = document.getElementById("connect-modal");

// Burger-menu entries that depend on the sign-in state.
const menuLogin = document.getElementById("menu-login");
const menuRegister = document.getElementById("menu-register");
const menuLogout = document.getElementById("menu-logout");
const menuProfile = document.getElementById("menu-profile");

/** Adapt the burger menu to the sign-in state: login ⇄ profile/logout. */
function setLoggedInMenu(loggedIn) {
  menuLogin?.classList.toggle("d-none", loggedIn);
  menuRegister?.classList.toggle("d-none", loggedIn);
  menuLogout?.classList.toggle("d-none", !loggedIn);
  menuProfile?.classList.toggle("d-none", !loggedIn);
}

// The three navbar states are mutually exclusive: disconnected /
// (anonymously) connected / signed in with an account.
function showConnected(text) {
  navStatus.textContent = text;
  navAccount.classList.add("d-none");
  navDisconnected.classList.add("d-none");
  navConnected.classList.remove("d-none");
  setLoggedInMenu(false);
}

function showDisconnected() {
  navConnected.classList.add("d-none");
  navAccount.classList.add("d-none");
  navDisconnected.classList.remove("d-none");
  setLoggedInMenu(false);
}

/** "Signed in with a user account" state: no connect/disconnect, only logout. */
function showAccount(profile) {
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email;
  navAccountName.textContent = "👤 " + name;
  navDisconnected.classList.add("d-none");
  navConnected.classList.add("d-none");
  navAccount.classList.remove("d-none");
  setLoggedInMenu(true);
}

function setConnectError(message) {
  if (!connectError) return;
  connectError.textContent = message || "";
  connectError.classList.toggle("d-none", !message);
}

/**
 * Derive the token, pair, and update the navbar.
 * @param {string} code  master_secret as a base64url code
 * @param {{fromModal?: boolean}} opts  when called from the modal, show errors there
 *        and close the modal on success; otherwise (auto-connect) fail silently.
 */
async function connect(code, { fromModal = false, fromAccount = false } = {}) {
  setConnectError("");
  try {
    const secret = gcCrypto.decodeMasterSecret(code);
    const keys = await gcCrypto.deriveKeys(secret);
    encKey = keys.encKey;
    client = new SyncClient(API_BASE, keys.authToken);
    await client.pair();
    // Note: localStorage is readable via XSS. Acceptable for an early stage;
    // "Disconnect" removes the token again.
    localStorage.setItem(STORAGE_KEY, code);
    // On account sign-in the navbar stays in the "account" state (showAccount);
    // we only show the "connected" status for anonymous sync.
    if (!fromAccount) {
      showConnected(t("Verbunden"));
    }
    if (fromModal) {
      bootstrap.Modal.getInstance(connectModalEl)?.hide();
    }
    // Activate sync additively: fetch from server, merge with local data, upload.
    // Local trips/tours are preserved in the process.
    await ridesStore.attachSync(encKey, client);
    await store.attachSync(encKey, client);
  } catch (err) {
    client = null;
    encKey = null;
    if (fromModal) {
      setConnectError(t("Verbindung fehlgeschlagen:") + " " + err.message);
    } else if (!fromAccount) {
      showDisconnected(); // silent failure on anonymous auto-connect
    }
  }
}

document.getElementById("btn-generate").addEventListener("click", () => {
  tokenInput.value = gcCrypto.encodeMasterSecret(gcCrypto.generateMasterSecret());
  setConnectError("");
});

// --- Pair with iPhone (QR code of the pairing URI) -------------------------
const pairQrModalEl = document.getElementById("pair-qr-modal");

/** Render QR + token in the pairing dialog. The QR is generated ONLY locally (the secret stays
 *  on the device); without a QR lib the token/URI remains as a text fallback. */
function renderPairQr(token) {
  const tokenEl = document.getElementById("pair-qr-token");
  if (tokenEl) tokenEl.textContent = token;
  const box = document.getElementById("pair-qr");
  if (!box) return;
  const uri = pairingUri(token);
  box.innerHTML = "";
  if (typeof qrcode !== "undefined") {
    try {
      const qr = qrcode(0, "M"); // version 0 = choose a fitting size automatically
      qr.addData(uri);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
      return;
    } catch {
      /* fallback below */
    }
  }
  box.innerHTML = `<div class="text-secondary small text-break">${uri}</div>`;
}

function openPairQr(token) {
  if (!token) return;
  renderPairQr(token);
  bootstrap.Modal.getOrCreateInstance(pairQrModalEl).show();
}

// From the connect dialog: take (or generate) the token and show the QR.
document.getElementById("btn-connect-qr")?.addEventListener("click", () => {
  let token = tokenInput.value.trim();
  if (!token) {
    token = gcCrypto.encodeMasterSecret(gcCrypto.generateMasterSecret());
    tokenInput.value = token;
  }
  connectModalEl.addEventListener("hidden.bs.modal", () => openPairQr(token), { once: true });
  bootstrap.Modal.getOrCreateInstance(connectModalEl).hide();
});

// From the burger menu: show the saved/current token, otherwise open Connect.
document.getElementById("menu-pair")?.addEventListener("click", () => {
  const token = localStorage.getItem(STORAGE_KEY) || tokenInput.value.trim();
  if (token) openPairQr(token);
  else bootstrap.Modal.getOrCreateInstance(connectModalEl).show();
});

// Copy the token to the clipboard.
document.getElementById("btn-pair-copy")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-pair-copy");
  const token = document.getElementById("pair-qr-token")?.textContent || "";
  try {
    await navigator.clipboard.writeText(token);
    const orig = btn.textContent;
    btn.textContent = t("Kopiert!");
    setTimeout(() => {
      btn.textContent = orig;
    }, 1500);
  } catch {
    /* clipboard possibly blocked → the token is selectable anyway (user-select) */
  }
});

document.getElementById("btn-connect").addEventListener("click", () => {
  const code = tokenInput.value.trim();
  if (!code) {
    setConnectError(t("Bitte Token eingeben oder generieren."));
    return;
  }
  connect(code, { fromModal: true });
});

document.getElementById("btn-disconnect").addEventListener("click", () => {
  // Only disconnect the sync — local trips/tours are preserved.
  store.detachSync();
  ridesStore.detachSync();
  client = null;
  encKey = null;
  localStorage.removeItem(STORAGE_KEY);
  showDisconnected();
});

// ===========================================================================
//  User accounts ("upgrade": create profile, login/logout)
// ===========================================================================

const profileModalEl = document.getElementById("profile-modal");
const loginModalEl = document.getElementById("login-modal");
const accountModalEl = document.getElementById("account-modal");

/** Set the error/success line of a modal (empty text = hide). */
function setProfileError(msg) {
  const el = document.getElementById("profile-error");
  el.textContent = msg || "";
  el.classList.toggle("d-none", !msg);
}
function setLoginError(msg) {
  const el = document.getElementById("login-error");
  el.textContent = msg || "";
  el.classList.add("text-danger");
  el.classList.remove("text-success");
  el.classList.toggle("d-none", !msg);
}

// Reset the previous state when opening the modals.
profileModalEl?.addEventListener("show.bs.modal", () => {
  setProfileError("");
  const ok = document.getElementById("profile-success");
  ok.textContent = "";
  ok.classList.add("d-none");
  document.getElementById("btn-profile-resend").classList.add("d-none");
  document.getElementById("btn-profile-submit").disabled = false;
});
// "Upgrade" first shows the explanatory dialog; "Understood, continue" closes it
// and opens the actual profile form (hide-then-show against a doubled backdrop).
document.getElementById("btn-upgrade-continue")?.addEventListener("click", () => {
  const upgradeEl = document.getElementById("upgrade-modal");
  upgradeEl.addEventListener(
    "hidden.bs.modal",
    () => bootstrap.Modal.getOrCreateInstance(profileModalEl).show(),
    { once: true },
  );
  bootstrap.Modal.getOrCreateInstance(upgradeEl).hide();
});
loginModalEl?.addEventListener("show.bs.modal", () => {
  setLoginError("");
  document.getElementById("btn-resend").classList.add("d-none");
});
// Fill the account info with the current profile data on open.
accountModalEl?.addEventListener("show.bs.modal", () => {
  document.getElementById("account-name").textContent =
    [account?.first_name, account?.last_name].filter(Boolean).join(" ") || "";
  document.getElementById("account-email").textContent = account?.email || "";
});

// Create profile ("upgrade"): binds the CURRENTLY connected master_secret to a
// real account and triggers the confirmation email.
document.getElementById("btn-profile-submit")?.addEventListener("click", async () => {
  setProfileError("");
  const first_name = document.getElementById("profile-first").value.trim();
  const last_name = document.getElementById("profile-last").value.trim();
  const email = document.getElementById("profile-email").value.trim();
  const password = document.getElementById("profile-pass").value;
  const password2 = document.getElementById("profile-pass2").value;

  if (!first_name || !last_name || !email || !password) {
    setProfileError(t("Bitte alle Felder ausfüllen."));
    return;
  }
  if (password !== password2) {
    setProfileError(t("Die Passwörter stimmen nicht überein."));
    return;
  }
  // Without an existing connection, generate a fresh master_secret so that
  // unconnected users can register too (the server holds it; on a later
  // login it's used to connect + decrypt, and local trips are uploaded additively
  // in the process).
  const master_secret = localStorage.getItem(STORAGE_KEY) || gcCrypto.encodeMasterSecret(gcCrypto.generateMasterSecret());
  try {
    await accounts.register({
      email,
      first_name,
      last_name,
      password,
      master_secret,
      auth_token: client ? client.authToken : "",
    });
    const ok = document.getElementById("profile-success");
    ok.textContent = t("Bestätigungsmail gesendet — bitte prüfe dein Postfach.");
    ok.classList.remove("d-none");
    document.getElementById("btn-profile-submit").disabled = true;
  } catch (err) {
    setProfileError(t("Registrierung fehlgeschlagen:") + " " + err.message);
    // "Already exists" (409): offer to resend the confirmation email (only applies to
    // not-yet-confirmed profiles – e.g. when the first email didn't arrive).
    document.getElementById("btn-profile-resend").classList.toggle("d-none", err.status !== 409);
  }
});

// Request the confirmation email again from the profile dialog. The response is
// deliberately non-revealing (no hint whether/that the profile is already active).
document.getElementById("btn-profile-resend")?.addEventListener("click", async () => {
  try {
    await accounts.resend(document.getElementById("profile-email").value.trim());
  } catch {
    /* silent */
  }
  setProfileError("");
  const ok = document.getElementById("profile-success");
  ok.textContent = t("Falls dein Profil noch nicht bestätigt ist, wurde die Bestätigungsmail erneut gesendet.");
  ok.classList.remove("d-none");
  document.getElementById("btn-profile-resend").classList.add("d-none");
});

// Login: signs in and connects automatically via the server-side stored
// master_secret (so the trips are decrypted on every device).
async function doLogin() {
  setLoginError("");
  document.getElementById("btn-resend").classList.add("d-none");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-pass").value;
  try {
    const data = await accounts.login(email, password);
    account = data;
    bootstrap.Modal.getInstance(loginModalEl)?.hide();
    showAccount(data);
    if (data.master_secret) await connect(data.master_secret, { fromAccount: true });
  } catch (err) {
    setLoginError(err.message);
    // Unconfirmed account → offer "resend".
    if (err.reason === "inactive") document.getElementById("btn-resend").classList.remove("d-none");
  }
}
document.getElementById("btn-login-submit")?.addEventListener("click", doLogin);

// Request the activation email again.
document.getElementById("btn-resend")?.addEventListener("click", async () => {
  try {
    await accounts.resend(document.getElementById("login-email").value.trim());
  } catch {
    /* silent: no enumeration hint */
  }
  const el = document.getElementById("login-error");
  el.textContent = t("Bestätigungsmail erneut gesendet.");
  el.classList.remove("d-none", "text-danger");
  el.classList.add("text-success");
});

// "Forgot password?": close the login modal, open the reset modal (prefill the
// email). Hide-then-show avoids a doubled modal backdrop.
document.getElementById("btn-forgot")?.addEventListener("click", () => {
  document.getElementById("reset-email").value = document.getElementById("login-email").value.trim();
  loginModalEl.addEventListener(
    "hidden.bs.modal",
    () => bootstrap.Modal.getOrCreateInstance(document.getElementById("reset-modal")).show(),
    { once: true },
  );
  bootstrap.Modal.getOrCreateInstance(loginModalEl).hide();
});

// Reset modal: clear the message on open.
document.getElementById("reset-modal")?.addEventListener("show.bs.modal", () => {
  const m = document.getElementById("reset-msg");
  m.textContent = "";
  m.classList.add("d-none");
});

// Request a reset link. The response is intentionally non-revealing
// (doesn't disclose whether the email exists).
document.getElementById("btn-reset-submit")?.addEventListener("click", async () => {
  try {
    await accounts.requestPasswordReset(document.getElementById("reset-email").value.trim());
  } catch {
    /* silent */
  }
  const m = document.getElementById("reset-msg");
  m.textContent = t("Falls ein Konto existiert, wurde ein Link gesendet.");
  m.classList.remove("d-none", "text-danger");
  m.classList.add("text-success");
});

// End the account session LOCALLY: clear account state, disconnect the sync,
// close the account modal, put the navbar into the anonymous state. Local trip
// data is preserved. Shared by logout and "delete profile".
function resetToAnonymous() {
  account = null;
  store.detachSync();
  ridesStore.detachSync();
  client = null;
  encKey = null;
  localStorage.removeItem(STORAGE_KEY);
  bootstrap.Modal.getInstance(accountModalEl)?.hide();
  showDisconnected();
}

// Logout: end the account session + disconnect the sync (local data is preserved).
async function doLogout() {
  try {
    await accounts.logout();
  } catch {
    /* session may already be gone — never mind */
  }
  resetToAnonymous();
}
document.getElementById("btn-logout")?.addEventListener("click", doLogout);
document.getElementById("menu-logout")?.addEventListener("click", doLogout);

// Delete profile: after confirmation, remove the account (user + profile) on the
// server and sign out. Only switch to the anonymous state on success (otherwise
// you stay signed in). The already-synced vault is kept (see accounts/DeleteProfileView).
async function doDeleteProfile() {
  if (!confirm(t("Profil wirklich unwiderruflich löschen? Dein Konto (Name, E-Mail, Passwort) wird entfernt und du wirst abgemeldet. Bereits synchronisierte Reisen bleiben erhalten."))) {
    return;
  }
  try {
    await accounts.deleteProfile();
  } catch (err) {
    alert(t("Profil konnte nicht gelöscht werden.") + " " + err.message);
    return;
  }
  resetToAnonymous();
}
document.getElementById("btn-delete-profile")?.addEventListener("click", doDeleteProfile);

// Change password (from the account modal): close the account modal, open the change modal.
function setPwChangeError(msg) {
  const el = document.getElementById("pwchange-error");
  el.textContent = msg || "";
  el.classList.toggle("d-none", !msg);
}
document.getElementById("btn-open-pwchange")?.addEventListener("click", () => {
  accountModalEl.addEventListener(
    "hidden.bs.modal",
    () => bootstrap.Modal.getOrCreateInstance(document.getElementById("pwchange-modal")).show(),
    { once: true },
  );
  bootstrap.Modal.getOrCreateInstance(accountModalEl).hide();
});
document.getElementById("pwchange-modal")?.addEventListener("show.bs.modal", () => {
  setPwChangeError("");
  const ok = document.getElementById("pwchange-success");
  ok.textContent = "";
  ok.classList.add("d-none");
  for (const id of ["pw-old", "pw-new", "pw-new2"]) document.getElementById(id).value = "";
  document.getElementById("btn-pwchange-submit").disabled = false;
});
document.getElementById("btn-pwchange-submit")?.addEventListener("click", async () => {
  setPwChangeError("");
  const oldPw = document.getElementById("pw-old").value;
  const newPw = document.getElementById("pw-new").value;
  const newPw2 = document.getElementById("pw-new2").value;
  if (!oldPw || !newPw) {
    setPwChangeError(t("Bitte alle Felder ausfüllen."));
    return;
  }
  if (newPw !== newPw2) {
    setPwChangeError(t("Die Passwörter stimmen nicht überein."));
    return;
  }
  try {
    await accounts.changePassword(oldPw, newPw);
    const ok = document.getElementById("pwchange-success");
    ok.textContent = t("Passwort geändert.");
    ok.classList.remove("d-none");
    document.getElementById("btn-pwchange-submit").disabled = true;
  } catch (err) {
    setPwChangeError(t("Passwort-Änderung fehlgeschlagen:") + " " + err.message);
  }
});

document.getElementById("btn-trips").addEventListener("click", () => planner.openTripsList());
document.getElementById("btn-touren").addEventListener("click", () => planner.openToursList());

// --- Routing settings (modal) ----------------------------------------

const rtVal = (id) => document.getElementById(id).value.trim();

function toggleRoutingGroups(provider) {
  for (const p of ["osrm", "ors", "brouter"]) {
    document.getElementById(`rt-group-${p}`).classList.toggle("d-none", p !== provider);
  }
}

// Toggle the ORS auth fields: API key OR username/password.
function toggleOrsAuth(mode) {
  document.getElementById("rt-ors-auth-key").classList.toggle("d-none", mode !== "key");
  document.getElementById("rt-ors-auth-basic").classList.toggle("d-none", mode !== "basic");
}

function fillRoutingSettings() {
  const cfg = loadRoutingConfig();
  document.getElementById("rt-provider").value = cfg.provider;
  document.getElementById("rt-osrm-base").value = cfg.osrmBase;
  document.getElementById("rt-osrm-profile").value = cfg.osrmProfile;
  document.getElementById("rt-ors-base").value = cfg.orsBase;
  document.getElementById("rt-ors-auth").value = cfg.orsAuthMode || "key";
  document.getElementById("rt-ors-key").value = cfg.orsKey;
  document.getElementById("rt-ors-user").value = cfg.orsUser || "";
  document.getElementById("rt-ors-pass").value = cfg.orsPassword || "";
  document.getElementById("rt-ors-profile").value = cfg.orsProfile;
  document.getElementById("rt-brouter-base").value = cfg.brouterBase;
  document.getElementById("rt-brouter-profile").value = cfg.brouterProfile;
  document.getElementById("rt-elev-enabled").checked = cfg.elevation ? cfg.elevation.enabled !== false : true;
  document.getElementById("rt-elev-url").value = (cfg.elevation && cfg.elevation.url) || "";
  toggleRoutingGroups(cfg.provider);
  toggleOrsAuth(cfg.orsAuthMode || "key");
}

document.getElementById("settings-modal").addEventListener("show.bs.modal", () => {
  fillRoutingSettings();
  renderPoiList("poi-list", "quick");
  renderPoiList("snap-list", "snap");
  showSettingsPage("menu"); // every open starts in the main menu
});
document.getElementById("rt-provider").addEventListener("change", (e) => toggleRoutingGroups(e.target.value));
document.getElementById("rt-ors-auth").addEventListener("change", (e) => toggleOrsAuth(e.target.value));
document.getElementById("rt-save").addEventListener("click", () => {
  const cfg = {
    provider: rtVal("rt-provider"),
    osrmBase: rtVal("rt-osrm-base"),
    osrmProfile: rtVal("rt-osrm-profile"),
    orsBase: rtVal("rt-ors-base"),
    orsAuthMode: rtVal("rt-ors-auth"),
    orsKey: rtVal("rt-ors-key"),
    orsUser: rtVal("rt-ors-user"),
    orsPassword: document.getElementById("rt-ors-pass").value, // do NOT trim the password
    orsProfile: rtVal("rt-ors-profile"),
    brouterBase: rtVal("rt-brouter-base"),
    brouterProfile: rtVal("rt-brouter-profile"),
    elevation: {
      enabled: document.getElementById("rt-elev-enabled").checked,
      url: rtVal("rt-elev-url") || "https://api.opentopodata.org/v1/srtm90m",
      maxPoints: 100,
    },
  };
  saveRoutingConfig(cfg);
  if (planner) planner.setRoutingConfig(cfg);
  bootstrap.Modal.getInstance(document.getElementById("settings-modal"))?.hide();
});

// --- Manage POI lists (map quick-targets "quick" + stage targets "snap") --
// Both use the same row UI; changes are saved immediately. The
// planner reads loadPOIs(kind) fresh each time (map popup / guided planner).

const escAttr = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let poiAddSeq = 0;

/** One row (active toggle + search term + remove) for a POI list. */
function poiRowHtml(p) {
  const on = p.enabled === false ? "" : "checked";
  return `<div class="input-group input-group-sm mb-1 poi-row${on ? "" : " poi-row-off"}" data-poi-id="${escAttr(p.id)}">
    <div class="input-group-text" title="${t("Aktiv / berücksichtigen")}">
      <input class="form-check-input mt-0" type="checkbox" role="switch" data-poi-enabled ${on}>
    </div>
    <input class="form-control" data-poi-query placeholder="${t("Suchbegriff")}" value="${escAttr(poiLabel(p.query))}">
    <button class="btn btn-outline-danger" type="button" data-poi-del title="${t("Entfernen")}">✕</button>
  </div>`;
}

/** Reads the visible rows of a list container as a POI list. */
function collectPois(listEl) {
  return [...listEl.querySelectorAll("[data-poi-id]")].map((row) => ({
    id: row.dataset.poiId,
    query: row.querySelector("[data-poi-query]").value,
    enabled: row.querySelector("[data-poi-enabled]").checked,
  }));
}

/** Wires up a single POI row (save on input/toggle, remove). */
function wirePoiRow(row, listEl, kind) {
  // Save + immediately update the map POI bar so that new/changed
  // quick targets are "applied" directly (only "quick" ends up in the bar;
  // "snap"/stage targets are read fresh by the guided planner anyway).
  const save = () => {
    savePOIs(collectPois(listEl), kind);
    if (kind === "quick") planner._renderPoiBar?.();
  };
  row.querySelector("[data-poi-query]")?.addEventListener("input", save);
  row.querySelector("[data-poi-enabled]")?.addEventListener("change", (e) => {
    row.classList.toggle("poi-row-off", !e.target.checked);
    save();
  });
  row.querySelector("[data-poi-del]")?.addEventListener("click", () => {
    row.remove();
    save();
  });
}

/** Rebuilds a POI list (container id + kind) from the saved state. */
function renderPoiList(listId, kind) {
  const listEl = document.getElementById(listId);
  if (!listEl) return;
  listEl.innerHTML = loadPOIs(kind).map(poiRowHtml).join("");
  listEl.querySelectorAll("[data-poi-id]").forEach((row) => wirePoiRow(row, listEl, kind));
}

/** "+" button: append an empty row (only saved once a term is typed). */
function wirePoiAdd(addId, listId, kind) {
  document.getElementById(addId)?.addEventListener("click", () => {
    const listEl = document.getElementById(listId);
    listEl.insertAdjacentHTML("beforeend", poiRowHtml({ id: `new-${poiAddSeq++}`, query: "" }));
    // Wire the new row by reference (lastElementChild) — NOT via
    // querySelector(data-poi-id): an already-saved POI can carry the same
    // "new-N" ID after a reload (the counter restarts at 0), in which case
    // the selector would hit the OLD row and the new one would have no save handler.
    wirePoiRow(listEl.lastElementChild, listEl, kind);
  });
}

wirePoiAdd("poi-add", "poi-list", "quick");
wirePoiAdd("snap-add", "snap-list", "snap");

// --- Settings: navigable menu (top-level → subpages, like iOS) ----

const settingsModalEl = document.getElementById("settings-modal");
const settingsTitleEl = document.getElementById("settings-modal-title");
const settingsBackBtn = document.getElementById("settings-back");
const SETTINGS_TITLES = {
  menu: "Einstellungen",
  routing: "Routing",
  quick: "Karten-Schnellziele",
  snap: "Etappen-Ziele",
  backup: "Sicherung & Übertragung",
};

/** Shows a settings page (menu or subpage) and sets title/back. */
function showSettingsPage(page) {
  settingsModalEl.querySelectorAll("[data-settings-page]").forEach((el) => {
    el.classList.toggle("d-none", el.dataset.settingsPage !== page);
  });
  settingsTitleEl.textContent = t(SETTINGS_TITLES[page] || "Einstellungen");
  settingsBackBtn.classList.toggle("d-none", page === "menu");
}

settingsModalEl.querySelectorAll("[data-settings-nav]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const target = btn.dataset.settingsNav;
    if (target === "connect") {
      // Connect dialog: first close Settings, then open Connect
      // (avoids a doubled modal backdrop).
      settingsModalEl.addEventListener(
        "hidden.bs.modal",
        () => bootstrap.Modal.getOrCreateInstance(connectModalEl).show(),
        { once: true },
      );
      bootstrap.Modal.getOrCreateInstance(settingsModalEl).hide();
      return;
    }
    showSettingsPage(target);
  }),
);
settingsBackBtn.addEventListener("click", () => showSettingsPage("menu"));

// --- Full export / import (trips + tours + settings) ----------------

const backupStatus = document.getElementById("backup-status");
const importFile = document.getElementById("import-file");

document.getElementById("btn-export-all")?.addEventListener("click", () => {
  const data = buildBackup(store, ridesStore, new Date().toISOString());
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gonecycling-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  if (backupStatus) backupStatus.textContent = t("Exportiert: {trips} Reisen, {rides} Touren/Routen.").replace("{trips}", data.trips.length).replace("{rides}", data.rides.length);
});

document.getElementById("btn-import-all")?.addEventListener("click", () => importFile?.click());

importFile?.addEventListener("change", async () => {
  if (!importFile.files || !importFile.files.length) return;
  const file = importFile.files[0];
  importFile.value = "";
  try {
    const obj = JSON.parse(await file.text());
    // Default: merge with existing data (safe). OK = replace completely.
    const merge = !confirm(
      t("Bestehende Reisen/Touren ZUERST löschen und vollständig ersetzen?\n\nOK = ersetzen · Abbrechen = zusammenführen"),
    );
    const res = applyBackup(obj, store, ridesStore, { merge });
    // Update the open detail view if needed (list/map/tours run via onChange).
    planner?.renderDetail();
    if (backupStatus) backupStatus.textContent = t("Importiert: {trips} Reisen, {rides} Touren/Routen.").replace("{trips}", res.trips).replace("{rides}", res.rides);
  } catch (err) {
    if (backupStatus) backupStatus.textContent = t("Import fehlgeschlagen:") + " " + err.message;
  }
});

// Determine the startup state:
//  1) Signed in (account session)? → "account" state + auto-connect via the
//     server-side stored master_secret.
//  2) Otherwise: anonymous auto-connect if a token is stored (additive sync).
// Offline/without a server, me() fails silently and case 2 takes effect.
(async () => {
  let acc = { authenticated: false };
  try {
    acc = await accounts.me();
  } catch {
    /* offline or similar → continue anonymously */
  }
  if (acc.authenticated) {
    account = acc;
    showAccount(acc);
    if (acc.master_secret) connect(acc.master_secret, { fromAccount: true });
  } else {
    const savedToken = localStorage.getItem(STORAGE_KEY);
    if (savedToken) {
      tokenInput.value = savedToken;
      connect(savedToken);
    }
  }
  // From the activation link (…/?login=1) open the login dialog – but only
  // if not (yet) signed in. Remove the parameter from the URL afterward
  // so a reload doesn't open the dialog again.
  const params = new URLSearchParams(location.search);
  if (params.get("login") === "1") {
    if (!acc.authenticated) {
      bootstrap.Modal.getOrCreateInstance(document.getElementById("login-modal")).show();
    }
    params.delete("login");
    const qs = params.toString();
    window.history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  }
})();
