// Trips store: **offline-first**. Primary storage is the browser's localStorage
// — planning works without a connection/login. An optional sync (token) is
// activated additively via `attachSync`: fetches the server version, merges it
// with the local one and uploads it encrypted.
import { encryptJSON, decryptJSON } from "gc/crypto";
import { ConflictError } from "gc/sync";
import { makeTrip, tripsFromArray, tripsToArray } from "gc/trips";

const NAMESPACE = "trips";
const LOCAL_KEY = "gc.local.trips";
const SAVE_DEBOUNCE_MS = 600;

/** Union by id; on collision the remote version wins (other device). */
function mergeById(local, remote) {
  const byId = new Map();
  for (const t of local) byId.set(t.id, t);
  for (const t of remote) byId.set(t.id, t);
  return [...byId.values()];
}

export class TripsStore {
  constructor() {
    this.trips = this._loadLocal();
    this.encKey = null; // set once sync is active
    this.client = null;
    this.revision = null;
    this.onChange = null;
    this._saveTimer = null;
  }

  get isSynced() {
    return !!(this.encKey && this.client);
  }

  _loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? tripsFromArray(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  }

  _saveLocal() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(tripsToArray(this.trips)));
    } catch (err) {
      console.error("localStorage (trips) failed:", err);
    }
  }

  /** Activate the optional sync: fetch from server, merge with local, upload. */
  async attachSync(encKey, client) {
    this.encKey = encKey;
    this.client = client;
    try {
      const pulled = await client.pull(NAMESPACE);
      if (pulled) {
        this.revision = pulled.revision;
        const remote = tripsFromArray(await decryptJSON(encKey, NAMESPACE, pulled.blob));
        this.trips = mergeById(this.trips, remote);
      } else {
        this.revision = null;
      }
      this._saveLocal();
      await this._push(); // upload the merged local version
    } catch (err) {
      console.error("Trips sync (attach) failed:", err);
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
    const encode = async () => encryptJSON(this.encKey, NAMESPACE, tripsToArray(this.trips));
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

  /** After changes: save locally, update the UI, (if synced) upload. */
  touch() {
    this._saveLocal();
    this._emit();
    if (!this.isSynced) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._push().catch((err) => console.error("Sync error:", err));
    }, SAVE_DEBOUNCE_MS);
  }

  async flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this.isSynced) await this._push();
  }

  createTrip(title) {
    const trip = makeTrip({ title: (title && title.trim()) || "New trip" });
    this.trips.unshift(trip);
    this.touch();
    return trip;
  }

  deleteTrip(id) {
    this.trips = this.trips.filter((t) => t.id !== id);
    this.touch();
  }

  getTrip(id) {
    return this.trips.find((t) => t.id === id) || null;
  }

  _emit() {
    if (this.onChange) this.onChange();
  }
}
