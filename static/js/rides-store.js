// Route/ride store (RideSession): **offline-first**, primary storage is
// localStorage; optional sync (additive) like in TripsStore. Holds both
// the per-stage routes of trips and standalone "rides".
import { encryptJSON, decryptJSON } from "gc/crypto";
import { ConflictError } from "gc/sync";
import { ridesFromArray, ridesToArray } from "gc/rides";

const NAMESPACE = "rides";
const LOCAL_KEY = "gc.local.rides";
const SAVE_DEBOUNCE_MS = 600;

function mergeById(local, remote) {
  const byId = new Map();
  for (const r of local) byId.set(r.id, r);
  for (const r of remote) byId.set(r.id, r);
  return [...byId.values()];
}

export class RidesStore {
  constructor() {
    this.rides = this._loadLocal();
    this.encKey = null;
    this.client = null;
    this.revision = null;
    this.onChange = null;
    this._saveTimer = null; // deferred sync push
    this._commitTimer = null; // deferred local commit (touchSoon)
  }

  get isSynced() {
    return !!(this.encKey && this.client);
  }

  _loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? ridesFromArray(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  }

  _saveLocal() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(ridesToArray(this.rides)));
    } catch (err) {
      console.error("localStorage (rides) failed:", err);
    }
  }

  async attachSync(encKey, client) {
    this.encKey = encKey;
    this.client = client;
    try {
      const pulled = await client.pull(NAMESPACE);
      if (pulled) {
        this.revision = pulled.revision;
        const remote = ridesFromArray(await decryptJSON(encKey, NAMESPACE, pulled.blob));
        this.rides = mergeById(this.rides, remote);
      } else {
        this.revision = null;
      }
      this._saveLocal();
      await this._push();
    } catch (err) {
      console.error("Rides sync (attach) failed:", err);
    }
    this._emit();
  }

  detachSync() {
    this.encKey = null;
    this.client = null;
    this.revision = null;
  }

  async _push() {
    if (!this.isSynced) return;
    const encode = async () => encryptJSON(this.encKey, NAMESPACE, ridesToArray(this.rides));
    try {
      const res = await this.client.push(NAMESPACE, await encode(), { contentVersion: 1, baseRevision: this.revision ?? undefined });
      this.revision = res.revision;
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      const cur = await this.client.pull(NAMESPACE);
      this.revision = cur ? cur.revision : null;
      const res = await this.client.push(NAMESPACE, await encode(), { contentVersion: 1, baseRevision: this.revision ?? undefined });
      this.revision = res.revision;
    }
  }

  /**
   * Immediate commit for discrete structural changes (add/delete a ride,
   * rating): save locally, notify the UI, schedule a push.
   */
  touch() {
    if (this._commitTimer) {
      clearTimeout(this._commitTimer);
      this._commitTimer = null;
    }
    this._saveLocal();
    this._emit();
    this._schedulePush();
  }

  /**
   * Like touch(), but for high-frequency input (typing in title/notes/tags).
   * Bundles the expensive full serialization of ALL samples (`_saveLocal`) and
   * the list recomputation (`_emit` → `rideStats` over all samples) into ONE run
   * after a short typing pause, instead of running them on every keystroke.
   * Otherwise typing visibly stutters for rides with many GPS points.
   */
  touchSoon() {
    if (this._commitTimer) clearTimeout(this._commitTimer);
    this._commitTimer = setTimeout(() => {
      this._commitTimer = null;
      this._saveLocal();
      this._emit();
      this._schedulePush();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Schedules a deferred sync push (only when connected). */
  _schedulePush() {
    if (!this.isSynced) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._push().catch((err) => console.error("Rides sync error:", err));
    }, SAVE_DEBOUNCE_MS);
  }

  /** Writes all pending changes immediately (e.g. when closing the page). */
  async flush() {
    if (this._commitTimer) {
      clearTimeout(this._commitTimer);
      this._commitTimer = null;
      this._saveLocal();
      this._emit();
    }
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this.isSynced) await this._push();
  }

  getRide(id) {
    return this.rides.find((r) => r.id === id) || null;
  }

  /** Adds a route/ride or replaces it (match by id). */
  upsertRide(ride) {
    const i = this.rides.findIndex((r) => r.id === ride.id);
    if (i >= 0) this.rides[i] = ride;
    else this.rides.unshift(ride);
    this.touch();
  }

  deleteRide(id) {
    this.rides = this.rides.filter((r) => r.id !== id);
    this.touch();
  }

  removeRides(ids) {
    const set = new Set(ids);
    const before = this.rides.length;
    this.rides = this.rides.filter((r) => !set.has(r.id));
    if (this.rides.length !== before) this.touch();
  }

  _emit() {
    if (this.onChange) this.onChange();
  }
}
