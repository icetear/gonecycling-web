// Pairing Web ↔ iPhone (GoneCycling app): builds the pairing URI that the QR code
// in the "Mit iPhone koppeln" dialog encodes. Format per docs/sync-protocol.md:
//   gonecycling://pair?v=1&s=<base64url(master_secret)>
// The `token` IS the base64url-encoded master_secret (crypto.encodeMasterSecret),
// so it contains only URL-safe characters (A–Z a–z 0–9 - _) → no encoding needed.

/** Pairing URI for the given token (empty/whitespace token → without an `s` value). */
export function pairingUri(token) {
  return "gonecycling://pair?v=1&s=" + String(token || "").trim();
}
