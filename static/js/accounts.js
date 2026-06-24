// HTTP client for the optional user accounts ("upgrade" path, /accounts).
//
// Unlike the token-based sync (gc/sync), these endpoints are
// **session-/CSRF-based** (Django's auth). The client reads the ``csrftoken``
// from the cookie (set by HomeView/MeView via ``ensure_csrf_cookie``) and sends
// it as the ``X-CSRFToken`` header — otherwise Django rejects the POSTs.
//
// Pure ES module without dependencies (uses fetch + document.cookie). Deliberately
// free of crypto/UI: it only moves JSON.

// API base incl. optional reverse-proxy sub-path (window.GC_BASE_PATH).
const BASE = location.origin + (window.GC_BASE_PATH || "") + "/accounts";

/** Reads the Django CSRF token from the ``csrftoken`` cookie (empty if none). */
function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

/**
 * POST with JSON body + CSRF header. On !ok throws an Error whose ``message``
 * carries the server message (``detail``); ``status``/``reason`` are attached to
 * the error for differentiated handling (e.g. reason="inactive").
 */
async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
    credentials: "same-origin",
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty/non-JSON response */
  }
  if (!res.ok) {
    const err = new Error(data.detail || "HTTP " + res.status);
    err.status = res.status;
    err.reason = data.reason;
    throw err;
  }
  return data;
}

/** Create a profile (upgrade): binds the current master_secret to a real account. */
export function register(profile) {
  return post("/register", profile);
}

/** Log in; on success returns ``{email, first_name, last_name, master_secret}``. */
export function login(email, password) {
  return post("/login", { email, password });
}

/** Log out (end the session). */
export function logout() {
  return post("/logout", {});
}

/** Request the activation email again (always responds ok). */
export function resend(email) {
  return post("/resend", { email });
}

/** Request a password-reset link (always responds ok — no enumeration). */
export function requestPasswordReset(email) {
  return post("/password/reset", { email });
}

/** Change password (while logged in): old + new password. */
export function changePassword(oldPassword, newPassword) {
  return post("/password/change", { old_password: oldPassword, new_password: newPassword });
}

/** Delete own account (while logged in): removes user + profile and ends the session. */
export function deleteProfile() {
  return post("/delete", {});
}

/**
 * Query the current login status. Returns ``{authenticated: false}`` for
 * anonymous visitors, or ``{authenticated: true, email, …, master_secret}`` for
 * logged-in accounts. Network/server errors become ``{authenticated: false}``.
 */
export async function me() {
  try {
    const res = await fetch(BASE + "/me", { credentials: "same-origin" });
    if (!res.ok) return { authenticated: false };
    return await res.json();
  } catch {
    return { authenticated: false };
  }
}
