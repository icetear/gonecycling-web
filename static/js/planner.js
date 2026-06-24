// Trip-planning UI of the web app (port of the iOS trip planning): trip list +
// detail editor (waypoints via map, stages, accommodations with price/nights,
// expenses, participants, start date, costs) including map markers and
// OSRM route preview. Browser module; uses Bootstrap + MapLibre (global) and
// the trip model (importmap).
import * as Trips from "gc/trips";
import { reverseGeocode, searchPlaces, searchNear } from "gc/geocode";
import { loadPOIs } from "gc/poi";
import { route as computeRoute, loadRoutingConfig } from "gc/routing";
import { haversineMeters, nearestIndex, routeLength, splitRoute } from "gc/autoplan";
import { plannedRideFromCoords } from "gc/rides";
import { buildGPX, parseGPX } from "gc/gpx";
import { rideStats, elevationGain } from "gc/ridestats";
import { estimateRideSeconds, formatDuration } from "gc/ridetime";
import { sunTimes } from "gc/sun";
import { supplyAlongRoute, largestCities } from "gc/overpass";
import { roundTripWaypoints, destinationPoint } from "gc/roundtrip";
import { withinBand, rankCandidates } from "gc/guided";
import { t as tr, poiLabel } from "gc/i18n";

const TRANSPORT_LABELS = {
  cycling: "Fahrrad",
  hiking: "Zu Fuß",
  car: "Auto",
  eScooter: "E-Scooter",
  eBike: "E-Bike",
  motorcycle: "Motorrad",
  skateboard: "Skateboard",
};

// Prefix of the map-pick mode for stage accommodations: `stageAcc:<stageId>`.
const STAGE_ACC_PREFIX = "stageAcc:";

// OSM `tourism` types that count as accommodation (hotel/guest house/hostel/camping …).
// Used in the guided planner to automatically adopt a destination as a stage
// accommodation when it really is accommodation (not a train station).
const ACCOMMODATION_OSM_TYPES = new Set([
  "hotel",
  "motel",
  "guest_house",
  "hostel",
  "apartment",
  "chalet",
  "alpine_hut",
  "wilderness_hut",
  "camp_site",
  "caravan_site",
  "resort",
]);

// Crosshair icon (Feather "crosshair", currentColor → theme-aware). Uniform
// everywhere you can jump straight to the map from a waypoint/stage destination/start
// location. A constant so all jump buttons look identical.
const CROSSHAIR_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="8"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/>' +
  '<line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>';

// Diagonal double arrow ("show/fit on the map", analogous to the iOS app).
const ROUTE_SHOW_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M15 3h6v6"/><path d="M21 3l-7 7"/><path d="M9 21H3v-6"/><path d="M3 21l7-7"/></svg>';

// Trash can icon for delete actions.
const TRASH_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

/** Downloads a text as a file (for GPX export). */
function downloadText(filename, text, mime = "application/gpx+xml") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const moneyFmt = new Intl.NumberFormat(navigator.language || "de", { style: "currency", currency: "EUR" });
const money = (n) => moneyFmt.format(n || 0);

/** Compact distance: "420 m" / "3,1 km". */
function fmtDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Address line from the Nominatim display_name without the leading name
 *  (otherwise the title would appear twice – as heading and in the address). */
function addressLine(name, displayName) {
  if (!displayName) return "";
  if (name && displayName.startsWith(`${name},`)) return displayName.slice(name.length + 1).trim();
  return displayName === name ? "" : displayName;
}

/** YYYY-MM-DD ↔ UTC-midnight Date. */
function dateToInput(date) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}
function inputToDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtDay(date) {
  return date ? new Date(date).toLocaleDateString(navigator.language || "de", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
}

/** Date → "HH:MM" (local time) or "" — for check-in time fields. */
function timeToInput(date) {
  if (!date) return "";
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** "HH:MM" → Date (today's date with this time; only the time of day matters). */
function inputToTime(value) {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

export class Planner {
  constructor(map) {
    this.map = map;
    this.store = null; // TripsStore
    this.ridesStore = null; // RidesStore (per-stage routes)
    this.selectedId = null;
    this.pickMode = null; // "start" | "end" | "stop" | null
    this.markers = [];
    this.searchMarkers = []; // markers of the global place/POI search (separate from waypoints)
    this.supplyMarkers = []; // supply POIs along a stage route
    this.searchCenter = null; // optional search center from "Search here" (one-shot)
    // Last search results (for the overlay when focusing the search field);
    // survive a reload thanks to localStorage.
    this.lastResults = this._loadRecentSearch();
    // Collapse/expand state of the detail boxes (remembered per section).
    this._sectionState = this._loadSectionState();
    // Tour-drawing mode: { points: [[lng,lat], …], markers: [] } or null.
    // A tour (standalone route) is drawn directly on the map point by point and
    // routed along the ways via the routing provider on completion — a trip, by
    // contrast, is created in the trips menu.
    this.tourDraft = null;
    this.routingConfig = loadRoutingConfig();

    // Offcanvas instances (Bootstrap).
    this.tripsOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById("trips-offcanvas"));
    this.tripOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById("trip-offcanvas"));
    this.autoplanModal = bootstrap.Modal.getOrCreateInstance(document.getElementById("autoplan-modal"));
    document.getElementById("ap-generate").addEventListener("click", () => this._runAutoplan());

    // Guided stage planner "Next stage".
    this.guidedModal = bootstrap.Modal.getOrCreateInstance(document.getElementById("guided-modal"));
    document.getElementById("guided-search")?.addEventListener("click", () => this._runGuidedSearch());

    // GPX import (file → new trip with route).
    const gpxBtn = document.getElementById("btn-import-gpx");
    const gpxFile = document.getElementById("gpx-file");
    if (gpxBtn && gpxFile) {
      gpxBtn.addEventListener("click", () => gpxFile.click());
      gpxFile.addEventListener("change", () => {
        if (this.store && gpxFile.files && gpxFile.files.length) {
          this._importGpx(gpxFile.files[0]).catch((e) => alert(tr("GPX-Import fehlgeschlagen:") + " " + e.message));
        }
        gpxFile.value = "";
      });
    }

    this.tripsListEl = document.getElementById("trips-list");
    this.detailEl = document.getElementById("trip-detail");
    this.bannerEl = document.getElementById("pick-banner");
    this.tripModeEl = document.getElementById("trip-mode-indicator");

    // Tours (standalone routes): offcanvas + statistics + round-trip modal.
    this.toursOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById("tours-offcanvas"));
    this.toursListEl = document.getElementById("tours-list");
    this.toursStatsEl = document.getElementById("tours-stats");
    this.tourOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById("tour-offcanvas"));
    this.tourDetailEl = document.getElementById("tour-detail");
    this.selectedTourId = null;
    const tourOcEl = document.getElementById("tour-offcanvas");
    // Confirm before closing if there are unsaved tour changes (vetoable).
    tourOcEl?.addEventListener("hide.bs.offcanvas", (e) => {
      if (this._tourDirty() && !confirm(tr("Ungespeicherte Änderungen an der Tour verwerfen?"))) {
        e.preventDefault();
      }
    });
    // Closing the tour detail panel ends the map editing of the tour.
    tourOcEl?.addEventListener("hidden.bs.offcanvas", () => {
      this.selectedTourId = null;
      this._discardEmptyTourDraft(); // don't leave behind a freshly started, empty 0-km tour
      this._endTourEdit();
    });
    this.roundtripModal = bootstrap.Modal.getOrCreateInstance(document.getElementById("roundtrip-modal"));

    const tourGpxBtn = document.getElementById("btn-import-tour-gpx");
    const tourGpxFile = document.getElementById("tour-gpx-file");
    if (tourGpxBtn && tourGpxFile) {
      tourGpxBtn.addEventListener("click", () => tourGpxFile.click());
      tourGpxFile.addEventListener("change", () => {
        if (this.ridesStore && tourGpxFile.files && tourGpxFile.files.length) {
          this._importTourGpx(tourGpxFile.files[0]).catch((e) => alert(tr("GPX-Import fehlgeschlagen:") + " " + e.message));
        }
        tourGpxFile.value = "";
      });
    }
    document.getElementById("btn-roundtrip")?.addEventListener("click", () => this.roundtripModal.show());
    // Print the day overview / save as PDF (print stylesheet shows only the roadbook).
    document.getElementById("btn-roadbook-print")?.addEventListener("click", () => window.print());
    document.getElementById("rtrip-generate")?.addEventListener("click", () => this._runRoundtrip());

    document.getElementById("btn-new-trip").addEventListener("click", () => {
      if (!this.store) return;
      const trip = this.store.createTrip("");
      this.select(trip.id);
    });
    this.map.on("click", (e) => this._onMapClick(e));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.tourDraft) {
        this.tourOffcanvas.hide(); // closes panel → ends tour editing (hidden listener)
        return;
      }
      if (this.pickMode) {
        this.pickMode = null;
        this._setBanner("");
        this.tripOffcanvas.show();
      }
    });

    // Wire up the global place/POI search in the navbar.
    this._wireNavSearch();
    // POI category bar above the map (quick targets in the current viewport).
    this._renderPoiBar();

    // Create the route source/layer once (as soon as the map is ready).
    if (this.map.isStyleLoaded()) this._ensureRouteLayer();
    else this.map.on("load", () => { this._ensureRouteLayer(); this.renderMap(); });

    this.renderList();
  }

  /** Attaches freshly connected stores (trips + routes) and re-renders. */
  setStores(tripsStore, ridesStore) {
    this.store = tripsStore;
    this.ridesStore = ridesStore;
    this.selectedId = null;
    tripsStore.onChange = () => {
      this.renderList();
      this.renderMap();
    };
    ridesStore.onChange = () => this.renderTours();
    this.renderList();
    this.renderTours();
    this.renderMap();
  }

  get trip() {
    return this.store && this.selectedId ? this.store.getTrip(this.selectedId) : null;
  }

  openTripsList() {
    if (!this.store) return;
    this.tripOffcanvas.hide(); // close the open detail (same side)
    this.renderList();
    this.tripsOffcanvas.show();
  }

  // --- Tours (standalone routes: GPX imports, round trips) -------------------

  openToursList() {
    this.tourOffcanvas.hide(); // close the open tour detail (same side)
    this.renderTours();
    this.toursOffcanvas.show();
  }

  /** IDs of all rides referenced by a trip stage. */
  _linkedRideIds() {
    const ids = new Set();
    if (!this.store) return ids;
    for (const t of this.store.trips) {
      for (const s of t.stages) if (s.plannedRouteRef) ids.add(s.plannedRouteRef.rideId);
    }
    return ids;
  }

  /** Standalone tours = rides that belong to no trip stage. */
  _standaloneTours() {
    if (!this.ridesStore) return [];
    const linked = this._linkedRideIds();
    return this.ridesStore.rides.filter((r) => !linked.has(r.id));
  }

  renderTours() {
    if (!this.toursListEl) return;
    const tours = this._standaloneTours();
    // Statistics over completed tours (planned round trips don't count).
    const s = rideStats(tours.filter((r) => r.kind === "completed"));
    if (this.toursStatsEl) {
      this.toursStatsEl.innerHTML =
        `<div class="d-flex justify-content-between"><span>${tr("Touren")}</span><span>${s.count}</span></div>` +
        `<div class="d-flex justify-content-between"><span>${tr("Gesamtdistanz")}</span><span>${(s.distanceMeters / 1000).toFixed(1)} km</span></div>` +
        `<div class="d-flex justify-content-between"><span>${tr("Höhenmeter")}</span><span>${Math.round(s.elevationGainMeters)} m</span></div>`;
    }
    if (!tours.length) {
      this.toursListEl.innerHTML = `<div class="text-secondary small p-2">${tr("Noch keine Touren. Importiere eine GPX-Datei oder generiere einen Rundkurs.")}</div>`;
      return;
    }
    this.toursListEl.innerHTML = tours
      .map((r) => {
        const km = (r.totalDistanceMeters / 1000).toFixed(1);
        const kind = r.kind === "completed" ? tr("Tour") : tr("geplant");
        return `<div class="list-group-item d-flex align-items-center gap-2">
          <button type="button" class="btn btn-link p-0 text-start flex-grow-1 text-decoration-none" data-show="${r.id}">
            <div class="fw-semibold">${esc(r.title || tr("Tour"))}</div>
            <div class="small text-secondary">${km} km · ${kind}</div>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-del="${r.id}" title="${tr("Löschen")}">✕</button>
        </div>`;
      })
      .join("");
    this.toursListEl.querySelectorAll("[data-show]").forEach((el) =>
      el.addEventListener("click", () => this.selectTour(el.dataset.show)),
    );
    this.toursListEl.querySelectorAll("[data-del]").forEach((el) =>
      el.addEventListener("click", () => {
        if (confirm(tr("Diese Tour löschen?"))) this.ridesStore.deleteRide(el.dataset.del);
      }),
    );
  }

  /** Select a tour: open the detail panel + edit the tour directly on the map. */
  selectTour(id) {
    const ride = this.ridesStore && this.ridesStore.getRide(id);
    if (!ride) return;
    this.selectedTourId = id;
    this.renderTourDetail();
    this.toursOffcanvas.hide();
    this.tourOffcanvas.show();
    this._beginTourEdit(ride); // immediately editable (markers + route on the map)
  }

  // --- Tour detail ----------------------------------------------------------

  get tour() {
    return this.ridesStore && this.selectedTourId ? this.ridesStore.getRide(this.selectedTourId) : null;
  }

  /** The three stat rows (distance/elevation gain/points) of a tour. */
  _tourStatsRows(r) {
    const km = (r.totalDistanceMeters / 1000).toFixed(1);
    const elev = Math.round(elevationGain(r.samples));
    return (
      `<div class="d-flex justify-content-between"><span>${tr("Distanz")}</span><span>${km} km</span></div>` +
      `<div class="d-flex justify-content-between"><span>${tr("Höhenmeter")}</span><span>${elev} m</span></div>` +
      `<div class="d-flex justify-content-between"><span>${tr("Punkte")}</span><span>${r.samples.length}</span></div>`
    );
  }

  /** Updates ONLY the stat block of the open tour panel (without touching input fields). */
  _refreshTourStats() {
    const el = this.tourDetailEl?.querySelector("#tf-stats");
    if (!el) return;
    const d = this.tourDraft;
    if (d) {
      // During editing: live values from the draft (not yet saved).
      const distM = d.routedDist || (d.routedCoords ? routeLength(d.routedCoords) : 0);
      el.innerHTML =
        `<div class="d-flex justify-content-between"><span>${tr("Distanz")}</span><span>${(distM / 1000).toFixed(1)} km${this._tourDirty() ? " *" : ""}</span></div>` +
        `<div class="d-flex justify-content-between"><span>${tr("Wegpunkte")}</span><span>${d.points.length}</span></div>`;
      return;
    }
    const r = this.tour;
    if (r) el.innerHTML = this._tourStatsRows(r);
  }

  renderTourDetail() {
    const r = this.tour;
    if (!r) {
      this.tourDetailEl.innerHTML = "";
      return;
    }
    const stars = [1, 2, 3, 4, 5]
      .map((n) => `<button type="button" class="btn btn-link p-0 fs-4 text-decoration-none" data-star="${n}" style="line-height:1">${n <= (r.rating || 0) ? "★" : "☆"}</button>`)
      .join("");
    this.tourDetailEl.innerHTML = `
      <input id="tf-title" class="form-control form-control-lg mb-3" placeholder="${tr("Tourname")}" value="${esc(r.title)}">

      <div id="tf-stats" class="card card-body py-2 mb-2 small">${this._tourStatsRows(r)}</div>
      <div id="tf-edittools" class="d-flex gap-1 mb-3"></div>

      <label class="form-label small mb-1">${tr("Wegpunkte")}</label>
      <div id="tf-waypoints" class="list-group mb-3"></div>

      <label class="form-label small mb-1">${tr("Transportmittel")}</label>
      <select id="tf-transport" class="form-select form-select-sm mb-3">
        ${Trips.TRANSPORT_MODES.map((m) => `<option value="${m}" ${r.transportMode === m ? "selected" : ""}>${tr(TRANSPORT_LABELS[m])}</option>`).join("")}
      </select>

      <label class="form-label small mb-1">${tr("Bewertung")}</label>
      <div id="tf-rating" class="mb-3 text-warning">${stars}</div>

      <label class="form-label small mb-1">${tr("Notizen")}</label>
      <textarea id="tf-notes" class="form-control form-control-sm mb-3" rows="2" placeholder="${tr("Notizen")}">${esc(r.notes || "")}</textarea>

      <label class="form-label small mb-1">${tr("Tags (mit Komma getrennt)")}</label>
      <input id="tf-tags" class="form-control form-control-sm mb-3" placeholder="${tr("z. B. Familie, Pendeln")}" value="${esc((r.tags || []).join(", "))}">

      <div class="small text-secondary mb-2">${tr("✏️ Die Route ist direkt auf der Karte bearbeitbar: Knoten ziehen zum Verschieben, auf die Linie klicken zum Einfügen, leere Stelle klicken zum Anhängen.")}</div>
      <button id="tf-fit" class="btn btn-outline-secondary w-100 mb-2">${tr("Auf Karte zentrieren")}</button>
      <button id="tf-export-gpx" class="btn btn-outline-secondary w-100 mb-2">${tr("GPX exportieren")}</button>
      <button id="tf-delete" class="btn btn-outline-danger w-100 mb-2">${tr("Tour löschen")}</button>
    `;
    this._wireTourDetail(r);
    if (this.tourDraft) this._refreshTourEditUI(); // fill buttons + waypoint list
  }

  _wireTourDetail(r) {
    const q = (sel) => this.tourDetailEl.querySelector(sel);
    // Typing in title/notes/tags: deferred commit, otherwise every keystroke
    // re-serializes all GPS samples + recomputes the statistics.
    const save = () => this.ridesStore.touchSoon();
    q("#tf-title").addEventListener("input", (e) => {
      r.title = e.target.value;
      save();
    });
    q("#tf-transport").addEventListener("change", (e) => {
      r.transportMode = e.target.value;
      save();
    });
    q("#tf-notes").addEventListener("input", (e) => {
      r.notes = e.target.value.trim() ? e.target.value : null;
      save();
    });
    q("#tf-tags").addEventListener("input", (e) => {
      const tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
      r.tags = tags.length ? tags : null;
      save();
    });
    this.tourDetailEl.querySelectorAll("[data-star]").forEach((el) =>
      el.addEventListener("click", () => {
        const n = Number(el.dataset.star);
        r.rating = r.rating === n ? null : n; // clicking the same star again = reset
        this.ridesStore.touch();
        this.renderTourDetail();
      }),
    );
    q("#tf-fit").addEventListener("click", () => {
      const wpts = this._tourEditWaypoints(r);
      if (wpts.length) this._fitToCoords(wpts);
    });
    q("#tf-export-gpx").addEventListener("click", () => this._exportTourGpx(r));
    q("#tf-delete").addEventListener("click", () => {
      if (!confirm(tr("Diese Tour löschen?"))) return;
      this.ridesStore.deleteRide(r.id);
      this.selectedTourId = null;
      this.tourOffcanvas.hide();
    });
  }

  _exportTourGpx(r) {
    if (!r.samples.length) {
      alert(tr("Keine Streckenpunkte zum Exportieren."));
      return;
    }
    const coords = r.samples.map((sm) => [sm.longitude, sm.latitude, sm.altitude]);
    const safeName = (r.title || "tour").replace(/[^\w.\-]+/g, "_");
    downloadText(`${safeName}.gpx`, buildGPX([{ name: r.title || tr("Tour"), coords }]));
  }

  _fitToCoords(coords) {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of coords) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    this.map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 40, maxZoom: 15 },
    );
  }

  /** Imports a GPX file as a standalone tour (completed → counts in the statistics). */
  async _importTourGpx(file) {
    const { name, points } = parseGPX(await file.text());
    if (points.length < 2) {
      alert(tr("Keine Streckenpunkte in der GPX-Datei gefunden."));
      return;
    }
    const title = name || file.name.replace(/\.gpx$/i, "") || "Importierte Tour";
    const ride = plannedRideFromCoords(points, { title, distanceMeters: routeLength(points) });
    ride.kind = "completed";
    this.ridesStore.upsertRide(ride);
    this.renderTours();
    this.selectTour(ride.id);
  }

  /** Generates a round trip from the current map center (target km in the modal). */
  async _runRoundtrip() {
    const statusEl = document.getElementById("rtrip-status");
    const km = parseFloat(document.getElementById("rtrip-km").value) || 0;
    if (km <= 0) {
      if (statusEl) statusEl.textContent = tr("Bitte eine Distanz angeben.");
      return;
    }
    if (statusEl) statusEl.textContent = tr("Route wird berechnet …");
    const c = this.map.getCenter();
    const rotation = Math.floor(Math.random() * 360);
    const wps = roundTripWaypoints([c.lng, c.lat], km * 1000, 4, rotation).map((p) => ({ longitude: p[0], latitude: p[1] }));
    const r = await computeRoute(this.routingConfig, wps);
    if (!r || !r.coordinates || r.coordinates.length < 2) {
      if (statusEl) statusEl.textContent = tr("Routing fehlgeschlagen.");
      return;
    }
    const dist = r.distanceMeters || routeLength(r.coordinates);
    const ride = plannedRideFromCoords(r.coordinates, {
      title: `${tr("Rundkurs")} ${(dist / 1000).toFixed(1)} km`,
      distanceMeters: dist,
      transportMode: "cycling",
    });
    this.ridesStore.upsertRide(ride);
    if (statusEl) statusEl.textContent = "";
    this.roundtripModal.hide();
    this.renderTours();
    this.selectTour(ride.id);
  }

  // --- Trip list ------------------------------------------------------------

  renderList() {
    const trips = this.store ? this.store.trips : [];
    if (!trips.length) {
      this.tripsListEl.innerHTML = `<div class="text-secondary small p-2">Noch keine Reisen. Lege eine an.</div>`;
      return;
    }
    this.tripsListEl.innerHTML = trips
      .map((t) => {
        const sub = [t.stages.length ? `${t.stages.length} Etappen` : null, t.plannedStartDate ? fmtDay(t.plannedStartDate) : null]
          .filter(Boolean)
          .join(" · ");
        return `<button type="button" class="list-group-item list-group-item-action${t.id === this.selectedId ? " active" : ""}" data-open="${t.id}">
          <div class="fw-semibold">${esc(t.title || "New trip")}</div>
          <div class="small ${t.id === this.selectedId ? "" : "text-secondary"}">${esc(sub)}</div>
        </button>`;
      })
      .join("");
    this.tripsListEl.querySelectorAll("[data-open]").forEach((el) =>
      el.addEventListener("click", () => this.select(el.dataset.open)),
    );
  }

  select(id) {
    this._endTourEdit(); // end any running tour editing
    this.selectedTourId = null;
    this.tourOffcanvas.hide();
    this.selectedId = id;
    this.pickMode = null;
    this._setBanner("");
    this.renderList();
    this.renderDetail();
    this.renderMap({ recenter: true }); // center on a trip when OPENING it
    this.tripsOffcanvas.hide();
    this.tripOffcanvas.show();
  }

  /** Clears the trip selection → empty map for a completely new planning. */
  _deselectTrip() {
    this.selectedId = null;
    this.pickMode = null;
    this._setBanner("");
    this.tripOffcanvas.hide();
    this.renderList();
    this.renderMap(); // without an active trip → markers/route are cleared
  }

  /**
   * Updates the trip-planning mode indicator (the amber pill at the top of the
   * map). It makes the trip mode visible — a click on the map then sets trip
   * waypoints (e.g. "As start accommodation"), not tour points. Until now this
   * was invisible once the detail panel was closed, and could only be turned off
   * by reloading.
   *
   * - Visible exactly when a trip is open (`this.trip`) and NO map pick is in
   *   progress (during a pick the `pick-banner` explains the action itself).
   * - Clicking the pill reopens the detail panel.
   * - "✕" exits trip mode (`_deselectTrip`) → back to tour planning.
   */
  _renderTripModeIndicator() {
    const el = this.tripModeEl;
    if (!el) return;
    const t = this.trip;
    if (!t || this.pickMode) {
      el.classList.add("d-none");
      el.innerHTML = "";
      return;
    }
    // Trip title as context; without a title the generic "Trip" term.
    const title = (t.title && t.title.trim()) || tr("Reise");
    el.innerHTML = `
      <button type="button" class="tmi-open" data-trip-mode-open title="${tr("Reise-Panel öffnen")}">
        <span aria-hidden="true">🧭</span>
        <span class="tmi-label">${tr("Reiseplanung")}: ${esc(title)}</span>
      </button>
      <button type="button" class="tmi-exit" data-trip-mode-exit title="${tr("Reiseplanung beenden")}" aria-label="${tr("Reiseplanung beenden")}">✕</button>`;
    el.classList.remove("d-none");
    el.querySelector("[data-trip-mode-open]")?.addEventListener("click", () => this.tripOffcanvas.show());
    el.querySelector("[data-trip-mode-exit]")?.addEventListener("click", () => this._deselectTrip());
  }

  // --- Detail editor --------------------------------------------------------

  /**
   * Collapsible detail box: panel header (clicking hides/shows the content) +
   * content. `key` identifies the box for remembering its state.
   */
  _section(key, title, body) {
    const collapsed = this._sectionState[key] === true;
    return `<section class="gc-section${collapsed ? " gc-collapsed" : ""}" data-section="${key}">
      <h6 class="gc-section-title" data-section-toggle role="button" tabindex="0" aria-expanded="${collapsed ? "false" : "true"}">
        <span class="gc-section-caret" aria-hidden="true">▾</span>${title}
      </h6>
      <div class="gc-section-body">${body}</div>
    </section>`;
  }

  /** Load the collapse state of the detail boxes (object key→collapsed). */
  _loadSectionState() {
    try {
      const o = JSON.parse(localStorage.getItem("gc.trip.sections") || "{}");
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }

  /** Save the collapse state of the detail boxes. */
  _saveSectionState() {
    try {
      localStorage.setItem("gc.trip.sections", JSON.stringify(this._sectionState));
    } catch {
      /* localStorage may be blocked → ignore */
    }
  }

  /**
   * Small map thumbnail of a stage: OpenStreetMap tiles as background
   * (the same source as the main map) + the route on top (with white casing,
   * start green / destination red). Offline only the tiles are missing, the route
   * stays visible. Empty string without enough points.
   */
  _routeThumbnail(ride) {
    const pts = ride && ride.samples;
    if (!pts || pts.length < 2) return "";
    // Thin out to ~200 points (compact, fast SVG).
    const step = Math.max(1, Math.floor(pts.length / 200));
    const s = [];
    for (let i = 0; i < pts.length; i += step) s.push(pts[i]);
    if (s[s.length - 1] !== pts[pts.length - 1]) s.push(pts[pts.length - 1]);
    const lats = s.map((p) => p.latitude);
    const lons = s.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    const W = 320;
    const H = 120;
    const PAD = 16;
    const TILE = 256;
    // Web Mercator: geographic coordinates → world pixels at zoom z.
    const lon2x = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
    const lat2y = (lat, z) => {
      const r = (lat * Math.PI) / 180;
      return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
    };
    // Largest zoom at which the route fits in (W-2·PAD)×(H-2·PAD).
    let z = 1;
    for (let cand = 2; cand <= 17; cand++) {
      const w = Math.abs(lon2x(maxLon, cand) - lon2x(minLon, cand));
      const h = Math.abs(lat2y(minLat, cand) - lat2y(maxLat, cand));
      if (w <= W - 2 * PAD && h <= H - 2 * PAD) z = cand;
      else break;
    }
    const n = 2 ** z;
    const left = (lon2x(minLon, z) + lon2x(maxLon, z)) / 2 - W / 2;
    const top = (lat2y(minLat, z) + lat2y(maxLat, z)) / 2 - H / 2;
    // Tile background (OpenStreetMap). Only the tiles that cover the view.
    let tiles = "";
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + W) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + H) / TILE); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n; // longitude wraparound
        const url = `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`;
        tiles += `<image href="${url}" x="${(tx * TILE - left).toFixed(1)}" y="${(ty * TILE - top).toFixed(1)}" width="${TILE}" height="${TILE}"/>`;
      }
    }
    const X = (lon) => lon2x(lon, z) - left;
    const Y = (lat) => lat2y(lat, z) - top;
    const d = s.map((p, i) => `${i ? "L" : "M"}${X(p.longitude).toFixed(1)} ${Y(p.latitude).toFixed(1)}`).join(" ");
    const sx = X(s[0].longitude);
    const sy = Y(s[0].latitude);
    const ex = X(s[s.length - 1].longitude);
    const ey = Y(s[s.length - 1].latitude);
    return `<svg class="gc-route-thumb" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${tr("Routenvorschau")}">
      ${tiles}
      <path d="${d}" fill="none" stroke="#fff" stroke-width="5" stroke-opacity="0.85" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="#7c3aed" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5" fill="#22c55e" stroke="#fff" stroke-width="2"/>
      <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="5" fill="#ef4444" stroke="#fff" stroke-width="2"/>
      <text x="${W - 3}" y="${H - 4}" text-anchor="end" font-size="8" fill="#000" fill-opacity="0.55">© OSM</text>
    </svg>`;
  }

  /**
   * Day overview / roadbook of a trip as an HTML table: per stage day,
   * date, route (A–B), km, elevation gain, estimated ride time and accommodation —
   * plus a header with totals and start accommodation. Print-friendly.
   */
  _roadbookHtml(t) {
    const dates = Trips.stageDates(t);
    const sum = this._tripSummary(t);
    const totalEta = estimateRideSeconds(sum.distanceMeters, sum.gainMeters || 0, t.transportMode || "cycling");
    const startStay = Trips.startStayDates(t);
    const accLine = (a) =>
      a && a.name
        ? `🛏 ${esc(a.name)}${a.price != null && a.price !== "" ? ` · ${money(Number(a.price))}` : ""}${a.isBooked ? ` · ${tr("gebucht")}` : ""}`
        : "—";
    const rows = t.stages
      .map((s, i) => {
        const ride = s.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(s.plannedRouteRef.rideId) : null;
        const gain = ride ? elevationGain(ride) : 0;
        const eta = ride ? estimateRideSeconds(ride.totalDistanceMeters, gain, t.transportMode || "cycling") : 0;
        const ep = this._stageEndpoints(t, s, i);
        const title = s.title || `${ep.start || tr("Start")} – ${ep.end || tr("Ziel")}`;
        const nights = s.overnightStays > 1 ? ` · ${s.overnightStays} ${tr("Nächte")}` : "";
        return `<tr>
          <td>${i + 1}</td>
          <td>${dates[i] ? fmtDay(dates[i]) : "—"}</td>
          <td>${esc(title)}</td>
          <td>${ride ? (ride.totalDistanceMeters / 1000).toFixed(1) : "—"}</td>
          <td>${gain > 0 ? "↑ " + Math.round(gain) : "—"}</td>
          <td>${ride ? "~" + formatDuration(eta) : "—"}</td>
          <td>${accLine(s.accommodation)}${nights}</td>
        </tr>`;
      })
      .join("");
    return `<div class="gc-roadbook">
      <h4 class="mb-1">${esc(t.title) || tr("Reise")}</h4>
      <div class="text-secondary mb-2">${(sum.distanceMeters / 1000).toFixed(1)} km · ↑ ${Math.round(sum.gainMeters || 0)} m · ⏱ ~${formatDuration(totalEta)}${sum.days ? ` · ${sum.days} ${tr("Tage")}` : ""} · ${money(Trips.totalCost(t))}</div>
      ${t.plannedStartDate ? `<div class="small mb-1"><strong>${tr("Geplanter Start")}:</strong> ${fmtDay(t.plannedStartDate)}</div>` : ""}
      ${t.startAccommodation && t.startAccommodation.name ? `<div class="small mb-2"><strong>${tr("Start-Unterkunft")}:</strong> ${accLine(t.startAccommodation)}${startStay ? ` (${fmtDay(startStay.start)} – ${fmtDay(startStay.end)})` : ""}</div>` : ""}
      <table class="gc-rb-table">
        <thead><tr><th>${tr("Tag")}</th><th>${tr("Datum")}</th><th>${tr("Etappe")}</th><th>km</th><th>↑ m</th><th>⏱</th><th>${tr("Unterkunft")}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="text-secondary">${tr("Noch keine Etappen.")}</td></tr>`}</tbody>
      </table>
    </div>`;
  }

  renderDetail() {
    const t = this.trip;
    if (!t) {
      this.detailEl.innerHTML = "";
      return;
    }
    const dates = Trips.stageDates(t);
    const startStay = Trips.startStayDates(t);
    const end = Trips.plannedEndDate(t);
    const multiParticipants = t.participants.length > 1;
    // "Start trip" only when there is a planned stage and none is active.
    const canStart = t.stages.some((s) => s.status === "planned") && !t.stages.some((s) => s.status === "active");
    // Possible templates = standalone tours; auto-stages works with a template OR start+destination.
    const templateCandidates = this._standaloneTours();
    const canAutoplan = (t.startWaypoint && t.endWaypoint) || !!t.assignedRouteId;
    const sum = this._tripSummary(t);
    const hasSummary = sum.stageCount > 0 || sum.distanceMeters > 0 || Trips.totalCost(t) !== 0;
    const totalEta = estimateRideSeconds(sum.distanceMeters, sum.gainMeters || 0, t.transportMode || "cycling");

    this.detailEl.innerHTML = `
      <div class="gc-trip-head mb-3">
        <input id="f-title" class="form-control form-control-lg" placeholder="${tr("Reisetitel")}" value="${esc(t.title)}">

        ${hasSummary ? `<div class="gc-trip-stats d-flex justify-content-around text-center small mt-2">
          <div><div class="fw-semibold">${(sum.distanceMeters / 1000).toFixed(1)} km</div><div class="text-secondary">${tr("Distanz")}</div></div>
          <div><div class="fw-semibold">${sum.stageCount}</div><div class="text-secondary">${tr("Etappen")}</div></div>
          ${sum.days ? `<div><div class="fw-semibold">${sum.days}</div><div class="text-secondary">${tr("Tage")}</div></div>` : ""}
          ${sum.gainMeters > 0 ? `<div><div class="fw-semibold">↑ ${Math.round(sum.gainMeters)} m</div><div class="text-secondary">${tr("Anstieg")}</div></div>` : ""}
          ${sum.distanceMeters > 0 ? `<div><div class="fw-semibold">~${formatDuration(totalEta)}</div><div class="text-secondary">${tr("Fahrzeit")}</div></div>` : ""}
          <div><div class="fw-semibold" id="summary-cost">${money(Trips.totalCost(t))}</div><div class="text-secondary">${tr("Kosten")}</div></div>
        </div>` : ""}

        <div class="row g-2 mt-1">
          <div class="col">
            <label class="form-label small mb-1">${tr("Geplanter Start")}</label>
            <input id="f-start-date" type="date" class="form-control form-control-sm" value="${dateToInput(t.plannedStartDate)}">
            ${end ? `<div class="form-text">${tr("Ende")}: ${fmtDay(end)}</div>` : ""}
          </div>
          <div class="col">
            <label class="form-label small mb-1">${tr("Transportmittel")}</label>
            <select id="f-transport" class="form-select form-select-sm">
              ${Trips.TRANSPORT_MODES.map((m) => `<option value="${m}" ${t.transportMode === m ? "selected" : ""}>${tr(TRANSPORT_LABELS[m])}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>

      ${this._section("vorlage", tr("Vorlage (Tour)"), `
        <div class="input-group input-group-sm mb-1">
          <select id="f-template" class="form-select form-select-sm">
            <option value="">${tr("— keine —")}</option>
            ${templateCandidates.map((r) => `<option value="${r.id}" ${t.assignedRouteId === r.id ? "selected" : ""}>${esc(r.title || tr("Tour"))} (${(r.totalDistanceMeters / 1000).toFixed(1)} km)</option>`).join("")}
          </select>
          <button class="btn btn-outline-secondary d-inline-flex align-items-center gc-jump" type="button" id="f-template-show" title="${tr("Vorlage auf der Karte anzeigen")}" ${t.assignedRouteId ? "" : "disabled"}>${CROSSHAIR_ICON}</button>
        </div>
        <div class="form-text">${tr("Wähle eine Tour als")} <span class="text-danger">${tr("rote Vorlage")}</span>; ${tr('„Auto-Etappen" teilt dann diese Strecke (auf Start/Ziel zugeschnitten, falls gesetzt).')}</div>
      `)}

      ${this._section("startAcc", tr("Start-Unterkunft"), this._accommodationBlock("start", t.startAccommodation, t.startNights, startStay))}

      ${this._section("stages", tr("Etappen"), `
        ${canStart ? `<button id="f-start-trip" class="btn btn-success btn-sm w-100 mb-2">${tr("▶ Reise starten")}</button>` : ""}
        <div id="stages">${t.stages.map((s, i) => this._stageBlock(s, i, dates[i], t)).join("") || `<div class="text-secondary small mb-2">${tr("Noch keine Etappen.")}</div>`}</div>
        <div class="d-flex flex-wrap gap-1">
          <button id="f-add-stage" class="btn btn-sm btn-outline-secondary">${tr("+ Etappe")}</button>
          <button id="f-guided" class="btn btn-sm btn-outline-primary">${tr("🧭 Nächste Etappe")}</button>
          ${canAutoplan ? `<button id="f-autoplan" class="btn btn-sm btn-outline-primary">${tr("Auto-Etappen")}</button>` : ""}
        </div>
      `)}

      ${this._section("participants", tr("Reiseteilnehmer"), `
        <div id="participants">${t.participants.map((p) => this._participantRow(p)).join("")}</div>
        <button id="f-add-participant" class="btn btn-sm btn-outline-secondary">${tr("+ Teilnehmer")}</button>
        ${t.participants.length === 1 ? `<div class="form-text mt-2">${tr("Alle Ausgaben werden {name} zugeordnet.").replace("{name}", esc(t.participants[0].name))}</div>` : ""}
      `)}

      ${this._section("expenses", tr("Ausgaben & Kosten"), `
        <div id="expenses">${t.expenses.map((e) => this._expenseRow(t, e, multiParticipants)).join("") || `<div class="text-secondary small mb-2">${tr("Noch keine Ausgaben.")}</div>`}</div>
        <button id="f-add-expense" class="btn btn-sm btn-outline-secondary mb-3">${tr("+ Ausgabe")}</button>

        <div class="card card-body py-2">
          <div class="d-flex justify-content-between small"><span>${tr("Unterkünfte")}</span><span id="cost-acc">${money(Trips.accommodationCostTotal(t))}</span></div>
          <div class="d-flex justify-content-between small"><span>${tr("Ausgaben")}</span><span id="cost-exp">${money(Trips.expensesTotal(t))}</span></div>
          <div class="d-flex justify-content-between fw-semibold border-top pt-1 mt-1"><span>${tr("Gesamtkosten")}</span><span id="cost-total">${money(Trips.totalCost(t))}</span></div>
        </div>
      `)}

      ${this._section("notes", tr("Notizen"), `
        <textarea id="f-notes" class="form-control form-control-sm" rows="2" placeholder="${tr("Notizen zur Reise")}">${esc(t.notes || "")}</textarea>
      `)}

      ${this._section("waypoints", tr("Wegpunkte"), `
        <div class="form-text mb-2">${tr("Nur für Auto-Etappen oder Planung ohne Vorlage nötig.")}</div>
        <div class="input-group input-group-sm mb-2">
          <input id="wp-search" class="form-control" placeholder="${tr("Ort suchen …")}" autocomplete="off">
          <button id="wp-search-btn" class="btn btn-outline-secondary" type="button">${tr("Suchen")}</button>
        </div>
        <div id="wp-search-results" class="list-group mb-2"></div>
        ${this._waypointRow(tr("Start"), "start", t.startWaypoint)}
        ${this._waypointRow(tr("Ziel"), "end", t.endWaypoint)}
        <div id="stops">${t.intermediateStops.map((s, i) => this._stopRow(s, i, t.intermediateStops.length)).join("")}</div>
        <button class="btn btn-sm btn-outline-secondary mb-2" data-pick="stop">${tr("+ Zwischenziel auf Karte")}</button>
        <div class="d-flex flex-wrap gap-1">
          <button id="f-locate-start" class="btn btn-sm btn-outline-secondary" title="${tr("Aktuellen Standort als Start setzen")}">${tr("📍 Mein Standort")}</button>
          <button id="f-reverse" class="btn btn-sm btn-outline-secondary" title="${tr("Start/Ziel und Reihenfolge umkehren")}">${tr("⇅ Umkehren")}</button>
          <button id="f-clear-wp" class="btn btn-sm btn-outline-danger" title="${tr("Alle Wegpunkte entfernen")}">${tr("🗑 Leeren")}</button>
        </div>
      `)}

      <button id="f-roadbook" class="btn btn-outline-secondary w-100 mb-2">${tr("🗓 Tagesübersicht")}</button>
      <button id="f-export-gpx" class="btn btn-outline-secondary w-100 mb-2">${tr("GPX exportieren")}</button>
      <button id="f-delete-trip" class="btn btn-outline-danger w-100 mb-2">${tr("Reise löschen")}</button>
    `;
    this._wireDetail(t);
  }

  /**
   * Crosshair button "show on the map" for a coordinate. Empty string when no
   * valid position exists (e.g. a waypoint set only by name). Activated via the
   * delegated `[data-jump]` handler in the detail wiring (or in
   * `_renderTourWaypointList`).
   */
  _jumpBtn(lng, lat) {
    if (lng == null || lat == null || Number.isNaN(+lng) || Number.isNaN(+lat)) return "";
    return `<button type="button" class="btn btn-sm btn-outline-secondary gc-jump" data-jump data-jump-lng="${lng}" data-jump-lat="${lat}" title="${tr("Auf der Karte zeigen")}">${CROSSHAIR_ICON}</button>`;
  }

  /** Flies the map to a coordinate (at least zoom 14) — target of the crosshair buttons. */
  _jumpTo(lng, lat) {
    if (lng == null || lat == null) return;
    this.map.flyTo({ center: [+lng, +lat], zoom: Math.max(this.map.getZoom(), 14) });
  }

  /** Wires up all crosshair buttons within a container (delegated). */
  _wireJumpButtons(scopeEl) {
    scopeEl?.querySelectorAll("[data-jump]").forEach((el) =>
      el.addEventListener("click", () => this._jumpTo(el.dataset.jumpLng, el.dataset.jumpLat)),
    );
  }

  _waypointRow(label, kind, wp) {
    const inner = wp
      ? `<input class="form-control form-control-sm" data-wp-name="${kind}" value="${esc(wp.name)}">
         ${this._jumpBtn(wp.longitude, wp.latitude)}
         <button class="btn btn-sm btn-outline-secondary" data-pick="${kind}" title="${tr("Auf Karte setzen")}">📍</button>
         <button class="btn btn-sm btn-outline-danger" data-wp-remove="${kind}" title="${tr("Entfernen")}">✕</button>`
      : `<button class="btn btn-sm btn-outline-secondary flex-grow-1 text-start" data-pick="${kind}">${label} ${tr("auf Karte setzen …")}</button>`;
    const loc = wp ? this._localityFor(wp.longitude, wp.latitude) : "";
    return `<div class="mb-2">
      <div class="d-flex align-items-center gap-1"><span class="small text-secondary" style="width:42px">${label}</span>${inner}</div>
      ${loc && loc !== (wp && wp.name) ? `<div class="gc-locality" style="margin-left:46px">${esc(loc)}</div>` : ""}
    </div>`;
  }

  _stopRow(stop, i, total) {
    const loc = this._localityFor(stop.longitude, stop.latitude);
    return `<div class="mb-2">
      <div class="d-flex align-items-center gap-1"><span class="small text-secondary" style="width:28px">#${i + 1}</span>
      <input class="form-control form-control-sm" data-stop-name="${stop.id}" value="${esc(stop.name)}">
      ${this._jumpBtn(stop.longitude, stop.latitude)}
      <button class="btn btn-sm btn-outline-secondary" data-stop-up="${stop.id}" ${i === 0 ? "disabled" : ""} title="${tr("Nach oben")}">▲</button>
      <button class="btn btn-sm btn-outline-secondary" data-stop-down="${stop.id}" ${i === total - 1 ? "disabled" : ""} title="${tr("Nach unten")}">▼</button>
      <button class="btn btn-sm btn-outline-danger" data-stop-remove="${stop.id}" title="${tr("Entfernen")}">✕</button></div>
      ${loc && loc !== stop.name ? `<div class="gc-locality" style="margin-left:32px">${esc(loc)}</div>` : ""}
    </div>`;
  }

  /**
   * Shared search/map control of an accommodation (start OR stage):
   * search field + 📍 button (map pick) + result list + optional coordinate badge.
   * Deliberately with `data-acc-*` attributes wired up by scope (detail root for
   * start, stage card for stage) → one implementation for both.
   */
  _accControls(a) {
    const hasCoord = a && a.latitude != null && a.longitude != null;
    const coordRow = hasCoord
      ? `<div class="d-flex align-items-center gap-1 mb-1">
           <span class="badge text-bg-warning">📍 ${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}</span>
           ${this._jumpBtn(a.longitude, a.latitude)}
           <button class="btn btn-sm btn-outline-danger py-0" data-acc-clear-coord title="${tr("Position entfernen")}">✕</button>
         </div>`
      : "";
    return `<div class="input-group input-group-sm mb-1">
        <input class="form-control" data-acc-search placeholder="${tr("Unterkunft suchen …")}" autocomplete="off">
        <button class="btn btn-outline-secondary" type="button" data-acc-search-btn>${tr("Suchen")}</button>
        <button class="btn btn-outline-secondary" type="button" data-acc-pick title="${tr("Auf Karte setzen")}">📍</button>
      </div>
      <div data-acc-search-results class="list-group mb-1"></div>
      ${coordRow}`;
  }

  _accommodationBlock(scope, acc, nights, startStay) {
    const a = acc || {};
    const nightsRow =
      scope === "start"
        ? `<div class="input-group input-group-sm mb-2">
             <span class="input-group-text">${tr("Nächte am Start")}</span>
             <input type="number" min="0" max="60" class="form-control" data-acc="${scope}" data-acc-field="startNights" value="${nights || 0}">
           </div>${startStay ? `<div class="form-text mb-2">${fmtDay(startStay.start)} – ${fmtDay(startStay.end)}</div>` : ""}`
        : "";
    return `
      <div id="start-acc-controls">${this._accControls(a)}</div>
      <input class="form-control form-control-sm mb-1" placeholder="${tr("Unterkunft (Name)")}" data-acc="${scope}" data-acc-field="name" value="${esc(a.name || "")}">
      <input class="form-control form-control-sm mb-1" placeholder="${tr("Adresse")}" data-acc="${scope}" data-acc-field="address" value="${esc(a.address || "")}">
      <div class="input-group input-group-sm mb-1">
        <input type="number" step="0.01" class="form-control" placeholder="${tr("Preis (gesamt)")}" data-acc="${scope}" data-acc-field="price" value="${a.price ?? ""}">
        <span class="input-group-text">€</span>
        <span class="input-group-text"><input type="checkbox" class="form-check-input mt-0" data-acc="${scope}" data-acc-field="isBooked" ${a.isBooked ? "checked" : ""}> <span class="ms-1">${tr("gebucht")}</span></span>
      </div>
      <div class="input-group input-group-sm mb-1">
        <span class="input-group-text">Check-in</span>
        <input type="time" class="form-control" data-acc="${scope}" data-acc-field="checkInTime" value="${timeToInput(a.checkInTime)}">
      </div>
      <textarea class="form-control form-control-sm mb-2" rows="1" placeholder="${tr("Notizen")}" data-acc="${scope}" data-acc-field="notes">${esc(a.notes || "")}</textarea>
      ${nightsRow}`;
  }

  _stageBlock(stage, i, date, t) {
    const a = stage.accommodation || {};
    const ride = stage.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(stage.plannedRouteRef.rideId) : null;
    // Elevation gain + rough ride time of this stage (for the ⏱ line below the route).
    const stageGain = ride ? elevationGain(ride) : 0;
    const stageEta = ride ? estimateRideSeconds(ride.totalDistanceMeters, stageGain, (t && t.transportMode) || "cycling") : 0;
    // Remaining distance from this stage to the end of the trip (this + all following).
    let restM = 0;
    if (t && this.ridesStore) {
      for (let k = i; k < t.stages.length; k++) {
        const rk = t.stages[k].plannedRouteRef ? this.ridesStore.getRide(t.stages[k].plannedRouteRef.rideId) : null;
        if (rk) restM += rk.totalDistanceMeters;
      }
    }
    // Route/distance section (like iOS TripStageEditScreen): the distance derives
    // from the stage route — either "Compute route" (start/destination from the
    // title "A – B" or the trip waypoints) or pick an existing tour.
    const anchors = t ? this._stageAnchors(t, stage) : { start: null, end: null };
    const canCalc = !!(anchors.start && anchors.end);
    const tours = this._standaloneTours();
    const routeSection = ride
      ? `<div class="d-flex align-items-center gap-2 mb-1 gc-route-actions">
           <span class="badge text-bg-primary">${(ride.totalDistanceMeters / 1000).toFixed(1)} km</span>
           <button class="btn btn-sm btn-outline-primary gc-jump" data-stage-route-show title="${tr("Route auf der Karte anzeigen")}">${ROUTE_SHOW_ICON}</button>
           <button class="btn btn-sm btn-outline-secondary gc-jump" data-stage-route-recalc title="${tr("Route neu berechnen")}">↻</button>
           <button class="btn btn-sm btn-outline-danger gc-jump" data-stage-route-remove title="${tr("Route entfernen")}">${TRASH_ICON}</button>
           <span class="ms-auto small text-secondary" title="${tr("Restdistanz bis Reiseende")}">${tr("Rest")}: ${(restM / 1000).toFixed(1)} km</span>
         </div>`
      : `<div class="mb-1">
           <div class="d-flex gap-1 align-items-center">
             <button class="btn btn-sm btn-outline-primary" data-stage-route-calc ${canCalc ? "" : "disabled"}>${tr("Route berechnen")}</button>
             <span class="form-text m-0">${canCalc ? tr("aus Start – Ziel") : tr("Etappe als Start – Ziel benennen")}</span>
           </div>
           ${tours.length ? `<select class="form-select form-select-sm mt-1" data-stage-route-select>
             <option value="">${tr("— oder vorhandene Tour wählen —")}</option>
             ${tours.map((r) => `<option value="${r.id}">${esc(r.title || tr("Tour"))} (${(r.totalDistanceMeters / 1000).toFixed(1)} km)</option>`).join("")}
           </select>` : ""}
         </div>`;
    const ep = this._stageEndpoints(t, stage, i);
    // Start/destination coordinates of the stage (for the "focus camera" crosshair
    // buttons): primarily from the stage route (first/last route point),
    // falling back for the first/last stage to the trip start/destination waypoint.
    const smp = ride && ride.samples.length ? ride.samples : null;
    const startC = smp ? [smp[0].longitude, smp[0].latitude] : i === 0 && t && t.startWaypoint ? [t.startWaypoint.longitude, t.startWaypoint.latitude] : null;
    const endC = smp ? [smp[smp.length - 1].longitude, smp[smp.length - 1].latitude] : t && i === t.stages.length - 1 && t.endWaypoint ? [t.endWaypoint.longitude, t.endWaypoint.latitude] : null;
    // Sunset at the stage destination on the planned stage day ("will I arrive before dark?").
    const sunset = date && endC ? sunTimes(date, endC[1], endC[0]).sunset : null;
    const sunsetStr = sunset ? sunset.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
    // Routing per section (leg) as a list — in addition to the section markers on
    // the map. Each row: destination of the leg + template/direct toggle.
    const legPts = [ep.start || tr("Start"), ...(stage.waypoints || []).map((w) => w.name || tr("Zwischenstopp")), ep.end || tr("Ziel")];
    const legDirectArr = this._stageLegDirect(stage);
    const legsHtml =
      ride && t && t.assignedRouteId && legDirectArr.length
        ? `<div class="mb-2">
             <div class="small text-secondary mb-1">${tr("Streckenführung")}:</div>
             ${legDirectArr
               .map(
                 (d, li) =>
                   `<div class="d-flex align-items-center gap-2 small mb-1">
                      <span class="flex-grow-1 text-truncate">→ ${esc(legPts[li + 1] || tr("Ziel"))}</span>
                      <button type="button" class="btn btn-sm py-0 ${d ? "btn-warning" : "btn-outline-secondary"}" data-stage-leg="${li}">${d ? `📏 ${tr("Direkt")}` : `🧭 ${tr("Vorlage folgen")}`}</button>
                    </div>`,
               )
               .join("")}
           </div>`
        : "";
    // Collapsed accommodation header (name · price · booked) or hint.
    const accSummary = a.name
      ? `🛏 ${esc(a.name)}${a.price != null && a.price !== "" ? ` · ${a.price} €` : ""}${a.isBooked ? ` · ${tr("gebucht")}` : ""}`
      : `🛏 ${tr("Unterkunft hinzufügen")}`;
    const accId = `acc-${stage.id}`; // unique collapse ID (stage UUID → with "acc-" it starts with a letter)
    // Status as a compact icon (glyph + color per status); click cycles the status.
    const statusMeta = { planned: ["○", tr("Geplant")], active: ["▶", tr("Aktiv")], completed: ["✓", tr("Abgeschlossen")] }[stage.status] || ["○", tr("Geplant")];
    return `<div class="card card-body py-2 gc-stage-card gc-status-${stage.status}${stage.id === this._selectedStageId ? " gc-stage-selected" : ""}" data-stage="${stage.id}">
      <!-- Kopf: Nummer · Status-Icon · Titel (volle Breite) · Entfernen -->
      <div class="d-flex gap-1 mb-2 align-items-center">
        <span class="badge rounded-pill text-bg-secondary gc-stage-num" title="${tr("Etappe")} ${i + 1}">${i + 1}</span>
        <button type="button" class="gc-stage-status-icon gc-status-${stage.status}" data-stage-status-cycle title="${statusMeta[1]} · ${tr("Status ändern")}">${statusMeta[0]}</button>
        <input class="form-control form-control-sm flex-grow-1" style="min-width:0" placeholder="${tr("Etappe")} ${i + 1}" data-stage-field="title" value="${esc(stage.title)}">
        <button class="btn btn-sm btn-outline-danger" data-stage-remove title="${tr("Entfernen")}">✕</button>
      </div>

      <!-- Start / Ziel klar erkennbar (mit Ort/Stadt in grau) -->
      <div class="gc-stage-od small">
        <div class="d-flex align-items-start gap-2 mb-1">
          <span class="gc-od-label">🟢 ${tr("Start")}</span>
          <div class="flex-grow-1" style="min-width:0">
            <div class="text-truncate text-body">${esc(ep.start) || "—"}</div>
            ${startC && this._localityFor(startC[0], startC[1]) && this._localityFor(startC[0], startC[1]) !== ep.start ? `<div class="text-truncate gc-locality">${esc(this._localityFor(startC[0], startC[1]))}</div>` : ""}
          </div>
          ${startC ? this._jumpBtn(startC[0], startC[1]) : ""}
        </div>
        <div class="d-flex align-items-start gap-2">
          <span class="gc-od-label">🏁 ${tr("Ziel")}</span>
          <div class="flex-grow-1" style="min-width:0">
            <div class="text-truncate text-body">${esc(ep.end) || "—"}</div>
            ${endC && this._localityFor(endC[0], endC[1]) && this._localityFor(endC[0], endC[1]) !== ep.end ? `<div class="text-truncate gc-locality">${esc(this._localityFor(endC[0], endC[1]))}</div>` : ""}
          </div>
          ${endC ? this._jumpBtn(endC[0], endC[1]) : ""}
        </div>
      </div>

      <!-- Routen-Optionen als eigener Bereich -->
      <div class="gc-stage-sec-label">${tr("Route")}</div>
      ${ride ? this._routeThumbnail(ride) : ""}
      ${routeSection}
      ${ride ? `<div class="small text-secondary mb-1">${stageGain > 0 ? "↑ " + Math.round(stageGain) + " m · " : ""}⏱ ~${formatDuration(stageEta)}</div>` : ""}
      ${ride ? `<div class="d-flex align-items-center gap-2 mb-1">
        <button class="btn btn-sm btn-outline-secondary" data-stage-supply title="${tr("Versorgung entlang der Route")}">🛒 ${tr("Versorgung")}</button>
        <span class="small text-secondary" data-supply-status></span>
      </div>` : ""}
      ${legsHtml}

      <!-- Zielunterkunft: Kurzfassung + aufklappbare Details -->
      <div class="gc-stage-sec-label">${tr("Unterkunft")}</div>
      <button class="btn btn-sm btn-light w-100 d-flex justify-content-between align-items-center gc-acc-summary" type="button" data-bs-toggle="collapse" data-bs-target="#${accId}" aria-expanded="false">
        <span class="text-truncate">${accSummary}</span><span class="ms-2 small">▾</span>
      </button>
      <div class="collapse" id="${accId}">
        <div class="pt-2">
          ${this._accControls(a)}
          <input class="form-control form-control-sm mb-1" placeholder="${tr("Unterkunft (Name)")}" data-stage-acc="name" value="${esc(a.name || "")}">
          <input class="form-control form-control-sm mb-1" placeholder="${tr("Adresse")}" data-stage-acc="address" value="${esc(a.address || "")}">
          <div class="input-group input-group-sm mb-1">
            <input type="number" step="0.01" class="form-control" placeholder="${tr("Preis")}" data-stage-acc="price" value="${a.price ?? ""}">
            <span class="input-group-text">€</span>
            <span class="input-group-text"><input type="checkbox" class="form-check-input mt-0" data-stage-acc="isBooked" ${a.isBooked ? "checked" : ""}> <span class="ms-1">${tr("gebucht")}</span></span>
          </div>
          <div class="input-group input-group-sm mb-1">
            <span class="input-group-text">Check-in</span>
            <input type="time" class="form-control" data-stage-acc="checkInTime" value="${timeToInput(a.checkInTime)}">
          </div>
          <textarea class="form-control form-control-sm" rows="1" placeholder="${tr("Unterkunft-Notiz")}" data-stage-acc="notes">${esc(a.notes || "")}</textarea>
        </div>
      </div>

      <!-- Fuß: Nächte · Datum -->
      <div class="d-flex flex-wrap align-items-center gap-3 mt-2 pt-2 border-top">
        <div class="input-group input-group-sm" style="max-width:130px">
          <span class="input-group-text">🌙</span>
          <input type="number" min="1" max="60" class="form-control" data-stage-field="overnightStays" value="${stage.overnightStays || 1}">
        </div>
        ${date ? `<span class="small text-secondary">📅 ${fmtDay(date)}</span>` : ""}
        ${sunsetStr ? `<span class="small text-secondary" title="${tr("Sonnenuntergang am Ziel")}">🌅 ${sunsetStr}</span>` : ""}
      </div>
      <textarea class="form-control form-control-sm mt-2" rows="1" placeholder="${tr("Etappen-Notiz")}" data-stage-field="notes">${esc(stage.notes || "")}</textarea>
      ${this._elevationProfileHtml(ride)}
    </div>`;
  }

  _participantRow(p) {
    return `<div class="d-flex gap-1 mb-2" data-participant="${p.id}">
      <input class="form-control form-control-sm" placeholder="Name" data-participant-name value="${esc(p.name)}">
      <button class="btn btn-sm btn-outline-danger" data-participant-remove title="${tr("Entfernen")}">✕</button></div>`;
  }

  _expenseRow(trip, e, multi) {
    const partSelect = multi
      ? `<select class="form-select form-select-sm" data-exp-field="participantId" style="max-width:130px">
           <option value="">${tr("— keiner —")}</option>
           ${trip.participants.map((p) => `<option value="${p.id}" ${e.participantId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
         </select>`
      : "";
    return `<div class="d-flex flex-wrap gap-1 mb-2 align-items-center" data-expense="${e.id}">
      <input class="form-control form-control-sm" style="flex:1 1 110px" placeholder="${tr("Titel")}" data-exp-field="title" value="${esc(e.title)}">
      <div class="input-group input-group-sm" style="width:120px">
        <input type="number" step="0.01" class="form-control" placeholder="${tr("Betrag")}" data-exp-field="amount" value="${e.amount ?? ""}">
        <span class="input-group-text">€</span>
      </div>
      <input type="date" class="form-control form-control-sm" style="width:140px" data-exp-field="date" value="${dateToInput(e.date)}">
      ${partSelect}
      <button class="btn btn-sm btn-outline-danger" data-exp-remove title="${tr("Entfernen")}">✕</button>
    </div>`;
  }

  // --- Detail wiring (mutate model + save) ----------------------------------

  _wireDetail(t) {
    const q = (sel) => this.detailEl.querySelector(sel);
    const save = () => this.store.touch();
    const rerender = () => {
      this.store.touch();
      this.renderDetail();
    };

    // Collapsible boxes: click/keyboard on the panel header hides/shows the
    // content and remembers the state per section (localStorage).
    this.detailEl.querySelectorAll("[data-section-toggle]").forEach((h) => {
      const toggle = () => {
        const sec = h.closest(".gc-section");
        if (!sec) return;
        const collapsed = sec.classList.toggle("gc-collapsed");
        h.setAttribute("aria-expanded", collapsed ? "false" : "true");
        this._sectionState[sec.dataset.section] = collapsed;
        this._saveSectionState();
      };
      h.addEventListener("click", toggle);
      h.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
    });

    q("#f-title").addEventListener("input", (e) => {
      t.title = e.target.value;
      this.renderList();
      save();
    });
    q("#f-start-date").addEventListener("change", (e) => {
      t.plannedStartDate = inputToDate(e.target.value);
      rerender();
    });
    q("#f-transport")?.addEventListener("change", (e) => {
      t.transportMode = e.target.value;
      if (this.ridesStore) {
        // Carry the transport mode over to the linked stage routes.
        for (const s of t.stages) {
          const ride = s.plannedRouteRef ? this.ridesStore.getRide(s.plannedRouteRef.rideId) : null;
          if (ride) ride.transportMode = t.transportMode;
        }
        this.ridesStore.touch();
      }
      save();
    });
    q("#f-export-gpx")?.addEventListener("click", () => this._exportGpx());
    q("#f-roadbook")?.addEventListener("click", () => {
      document.getElementById("roadbook").innerHTML = this._roadbookHtml(t);
      bootstrap.Modal.getOrCreateInstance(document.getElementById("roadbook-modal")).show();
    });
    q("#f-template")?.addEventListener("change", (e) => {
      t.assignedRouteId = e.target.value || null;
      rerender(); // update map (red template) + auto-stages button
    });
    q("#f-template-show")?.addEventListener("click", () => {
      const coords = this._templateCoords(t); // geometry of the assigned template
      if (coords.length >= 2) this._fitToCoords(coords); // fit the map to the (red) template
    });
    q("#f-notes")?.addEventListener("input", (e) => {
      t.notes = e.target.value;
      save();
    });
    q("#f-start-trip")?.addEventListener("click", () => {
      const next = t.stages.find((s) => s.status === "planned");
      if (!next) return;
      next.status = "active";
      this.store.touch();
      this.renderDetail();
      // Jump to the active stage if it has a route.
      const ride = next.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(next.plannedRouteRef.rideId) : null;
      if (ride && ride.samples.length >= 2) {
        this._fitToCoords(ride.samples.map((sm) => [sm.longitude, sm.latitude]));
        this.tripOffcanvas.hide();
      }
    });

    // Place search (forward geocoding) → adopt a result as start/destination/stop
    const searchInput = q("#wp-search");
    const runSearch = async () => {
      const box = q("#wp-search-results");
      box.innerHTML = `<div class="text-secondary small px-1">${tr("Suche …")}</div>`;
      const results = await searchPlaces(searchInput.value, 5);
      if (!results.length) {
        box.innerHTML = `<div class="text-secondary small px-1">Keine Treffer.</div>`;
        return;
      }
      box.innerHTML = results
        .map(
          (r, i) => `<div class="list-group-item py-1 px-2 d-flex align-items-center gap-1">
            <span class="small flex-grow-1 text-truncate" title="${esc(r.displayName)}">${esc(r.name)}</span>
            <button class="btn btn-sm btn-outline-success py-0" data-res="${i}" data-slot="start">${tr("Start")}</button>
            <button class="btn btn-sm btn-outline-danger py-0" data-res="${i}" data-slot="end">${tr("Ziel")}</button>
            <button class="btn btn-sm btn-outline-primary py-0" data-res="${i}" data-slot="stop">${tr("+Stopp")}</button>
          </div>`,
        )
        .join("");
      box.querySelectorAll("[data-res]").forEach((el) =>
        el.addEventListener("click", () => {
          const r = results[Number(el.dataset.res)];
          const wp = Trips.makeWaypoint({ name: r.name, latitude: r.lat, longitude: r.lon });
          if (el.dataset.slot === "start") t.startWaypoint = wp;
          else if (el.dataset.slot === "end") t.endWaypoint = wp;
          else t.intermediateStops.push(wp);
          searchInput.value = "";
          this.store.touch();
          this.renderDetail();
        }),
      );
    };
    q("#wp-search-btn").addEventListener("click", runSearch);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch();
      }
    });

    // Waypoints
    this.detailEl.querySelectorAll("[data-pick]").forEach((el) =>
      el.addEventListener("click", () => this._startPick(el.dataset.pick)),
    );
    // Crosshair buttons (start/destination/stops/accommodations) → show on the map.
    this._wireJumpButtons(this.detailEl);
    // Quick actions: location as start, reverse route, clear waypoints.
    q("#f-locate-start")?.addEventListener("click", () => this._useMyLocationAsStart());
    q("#f-reverse")?.addEventListener("click", () => this._reverseRoute());
    q("#f-clear-wp")?.addEventListener("click", () => {
      if (!confirm(tr("Alle Wegpunkte (Start, Ziel, Zwischenziele) entfernen?"))) return;
      t.startWaypoint = null;
      t.endWaypoint = null;
      t.intermediateStops = [];
      this.store.touch();
      this.renderDetail();
      this.renderMap();
    });
    this.detailEl.querySelectorAll("[data-wp-name]").forEach((el) =>
      el.addEventListener("input", (e) => {
        const wp = el.dataset.wpName === "start" ? t.startWaypoint : t.endWaypoint;
        if (wp) {
          wp.name = e.target.value;
          save();
        }
      }),
    );
    this.detailEl.querySelectorAll("[data-wp-remove]").forEach((el) =>
      el.addEventListener("click", () => {
        if (!confirm(tr("Diesen Wegpunkt entfernen?"))) return;
        if (el.dataset.wpRemove === "start") t.startWaypoint = null;
        else t.endWaypoint = null;
        rerender();
      }),
    );
    this.detailEl.querySelectorAll("[data-stop-name]").forEach((el) =>
      el.addEventListener("input", (e) => {
        const stop = t.intermediateStops.find((s) => s.id === el.dataset.stopName);
        if (stop) {
          stop.name = e.target.value;
          save();
        }
      }),
    );
    this.detailEl.querySelectorAll("[data-stop-remove]").forEach((el) =>
      el.addEventListener("click", () => {
        if (!confirm(tr("Dieses Zwischenziel entfernen?"))) return;
        t.intermediateStops = t.intermediateStops.filter((s) => s.id !== el.dataset.stopRemove);
        rerender();
      }),
    );
    this.detailEl.querySelectorAll("[data-stop-up]").forEach((el) =>
      el.addEventListener("click", () => this._moveStop(t, el.dataset.stopUp, -1)),
    );
    this.detailEl.querySelectorAll("[data-stop-down]").forEach((el) =>
      el.addEventListener("click", () => this._moveStop(t, el.dataset.stopDown, 1)),
    );

    // Accommodations (start + stages): generic fields
    this.detailEl.querySelectorAll("[data-acc]").forEach((el) =>
      el.addEventListener(el.type === "checkbox" ? "change" : "input", (e) => {
        const field = el.dataset.accField;
        if (field === "startNights") {
          t.startNights = Math.max(0, parseInt(e.target.value || "0", 10) || 0);
          rerender();
          return;
        }
        const acc = t.startAccommodation || Trips.makeAccommodation({});
        if (field === "price") acc.price = e.target.value === "" ? null : Number(e.target.value);
        else if (field === "isBooked") acc.isBooked = e.target.checked;
        else if (field === "checkInTime") acc.checkInTime = inputToTime(e.target.value);
        else acc[field] = e.target.value;
        t.startAccommodation = Trips.accommodationIsEmpty(acc) ? null : acc;
        save();
        if (field === "price") this._updateCostSummary(t); // update total cost live
      }),
    );

    // Start accommodation: search/map control (own container, cleanly scoped).
    this._wireAccSearch(this.detailEl.querySelector("#start-acc-controls"), this._startAccHolder(t));

    // Stages
    q("#f-add-stage")?.addEventListener("click", () => {
      // A new stage adopts the destination of the previous stage as its start (title
      // "PreviousDestination – "); the start anchor additionally comes from _stageAnchors.
      const prevDest = t.stages.length ? this._destName(t.stages[t.stages.length - 1].title) : "";
      t.stages.push(Trips.makeStage({ title: prevDest ? `${prevDest} – ` : `Etappe ${t.stages.length + 1}` }));
      rerender();
    });
    q("#f-autoplan")?.addEventListener("click", () => this.autoplanModal.show());
    q("#f-guided")?.addEventListener("click", () => this._openGuided());
    this.detailEl.querySelectorAll("[data-stage]").forEach((card) => {
      const stage = t.stages.find((s) => s.id === card.dataset.stage);
      if (!stage) return;
      // Clicking the box itself (not the controls) selects the stage →
      // map highlight + route highlight + side menu selection.
      card.addEventListener("click", (e) => {
        if (e.target.closest("input, button, select, textarea, a, label")) return;
        this._selectStage(stage);
      });
      card.querySelectorAll("[data-stage-field]").forEach((el) =>
        el.addEventListener(el.tagName === "SELECT" ? "change" : "input", (e) => {
          const f = el.dataset.stageField;
          if (f === "overnightStays") {
            stage.overnightStays = Math.max(1, parseInt(e.target.value || "1", 10) || 1);
            rerender();
          } else if (f === "status") {
            stage.status = e.target.value;
            save();
          } else if (f === "notes") {
            stage.notes = e.target.value;
            save();
          } else {
            stage.title = e.target.value;
            save();
          }
        }),
      );
      card.querySelectorAll("[data-stage-acc]").forEach((el) =>
        el.addEventListener(el.type === "checkbox" ? "change" : "input", (e) => {
          const acc = stage.accommodation || Trips.makeAccommodation({});
          const f = el.dataset.stageAcc;
          if (f === "price") acc.price = e.target.value === "" ? null : Number(e.target.value);
          else if (f === "isBooked") acc.isBooked = e.target.checked;
          else if (f === "checkInTime") acc.checkInTime = inputToTime(e.target.value);
          else acc[f] = e.target.value;
          stage.accommodation = Trips.accommodationIsEmpty(acc) ? null : acc;
          save();
          if (f === "price") this._updateCostSummary(t); // update total cost live
        }),
      );
      // Stage accommodation: search/map control (limited to this card).
      this._wireAccSearch(card, this._stageAccHolder(t, stage));

      // Stage route/distance: compute / recompute / existing tour / remove.
      const calcRoute = (btn) => {
        btn.disabled = true;
        btn.textContent = tr("Berechne …");
        this._computeStageRoute(t, stage).catch((err) => {
          alert(tr("Fehler:") + " " + err.message);
          this.renderDetail();
        });
      };
      card.querySelector("[data-stage-route-calc]")?.addEventListener("click", (ev) => calcRoute(ev.currentTarget));
      card.querySelector("[data-stage-route-recalc]")?.addEventListener("click", (ev) => calcRoute(ev.currentTarget));
      card.querySelector("[data-stage-route-show]")?.addEventListener("click", () => this._showStageRoute(stage));
      card.querySelectorAll("[data-stage-leg]").forEach((b) =>
        b.addEventListener("click", () => {
          this._toggleStageLeg(stage, Number(b.dataset.stageLeg)); // section: template ⇄ direct
          this.store.touch();
          this._recomputeStageWithVias(t, stage); // re-routes (camera stays — renderMap only centers on opening)
        }),
      );
      card.querySelector("[data-stage-route-select]")?.addEventListener("change", (e) => {
        if (!e.target.value) return;
        stage.plannedRouteRef = { rideId: e.target.value };
        this.store.touch();
        this.renderDetail();
        this.renderMap();
      });
      card.querySelector("[data-stage-route-remove]")?.addEventListener("click", () => {
        if (!confirm(tr("Route dieser Etappe entfernen?"))) return;
        stage.plannedRouteRef = null; // the tour itself is kept (like iOS)
        this.store.touch();
        this.renderDetail();
        this.renderMap();
      });

      // Status icon: click cycles planned → active → completed → planned.
      card.querySelector("[data-stage-status-cycle]")?.addEventListener("click", () => {
        const order = ["planned", "active", "completed"];
        stage.status = order[(order.indexOf(stage.status) + 1) % order.length];
        rerender();
      });

      // Fetch supply along the route + show as markers.
      card.querySelector("[data-stage-supply]")?.addEventListener("click", (ev) => this._showSupply(stage, ev.currentTarget));

      card.querySelector("[data-stage-remove]")?.addEventListener("click", () => {
        if (!confirm(tr("Diese Etappe entfernen?"))) return;
        if (stage.plannedRouteRef && this.ridesStore) this.ridesStore.removeRides([stage.plannedRouteRef.rideId]);
        t.stages = t.stages.filter((s) => s.id !== stage.id);
        rerender();
      });
    });

    // Participants
    q("#f-add-participant")?.addEventListener("click", () => {
      t.participants.push(Trips.makeParticipant({ name: "" }));
      rerender();
    });
    this.detailEl.querySelectorAll("[data-participant]").forEach((row) => {
      const p = t.participants.find((x) => x.id === row.dataset.participant);
      if (!p) return;
      row.querySelector("[data-participant-name]")?.addEventListener("input", (e) => {
        p.name = e.target.value;
        this.renderList();
        save();
      });
      row.querySelector("[data-participant-remove]")?.addEventListener("click", () => {
        if (!confirm(tr("Teilnehmer entfernen?"))) return;
        t.participants = t.participants.filter((x) => x.id !== p.id);
        // dissolve orphaned assignments
        for (const ex of t.expenses) if (ex.participantId === p.id) ex.participantId = null;
        rerender();
      });
    });

    // Expenses
    q("#f-add-expense")?.addEventListener("click", () => {
      t.expenses.push(Trips.makeExpense({ title: "" }));
      rerender();
    });
    this.detailEl.querySelectorAll("[data-expense]").forEach((row) => {
      const ex = t.expenses.find((x) => x.id === row.dataset.expense);
      if (!ex) return;
      row.querySelectorAll("[data-exp-field]").forEach((el) =>
        el.addEventListener(el.tagName === "SELECT" || el.type === "date" ? "change" : "input", (e) => {
          const f = el.dataset.expField;
          if (f === "amount") {
            ex.amount = e.target.value === "" ? 0 : Number(e.target.value);
            save();
            this._updateCostSummary(t); // without renderDetail → focus stays in the field
          } else if (f === "date") {
            ex.date = inputToDate(e.target.value);
            save();
          } else if (f === "participantId") {
            ex.participantId = e.target.value || null;
            save();
          } else {
            ex.title = e.target.value;
            save();
          }
        }),
      );
      row.querySelector("[data-exp-remove]")?.addEventListener("click", () => {
        if (!confirm(tr("Ausgabe entfernen?"))) return;
        t.expenses = t.expenses.filter((x) => x.id !== ex.id);
        rerender();
      });
    });

    q("#f-delete-trip")?.addEventListener("click", () => {
      if (!confirm(tr("Diese Reise wirklich löschen?"))) return;
      if (this.ridesStore) {
        this.ridesStore.removeRides(t.stages.map((s) => s.plannedRouteRef?.rideId).filter(Boolean));
      }
      this.store.deleteTrip(t.id);
      this.selectedId = null;
      this.tripOffcanvas.hide();
    });
  }

  // --- Map: set waypoint, markers + route -----------------------------------

  _startPick(mode) {
    this.pickMode = mode;
    const labels = { start: tr("Start"), end: tr("Ziel"), stop: tr("Zwischenziel"), startAccommodation: tr("Start-Unterkunft") };
    const label = labels[mode] || (mode.startsWith(STAGE_ACC_PREFIX) ? "Etappen-Unterkunft" : "Wegpunkt");
    this._setBanner(tr('Tippe auf die Karte, um „{label}" zu setzen … (Esc bricht ab)').replace("{label}", label));
    this.tripOffcanvas.hide();
  }

  _onMapClick(e) {
    // Without an active waypoint mode: a unified info box at the tapped point.
    // If the click hit the displayed route, the box offers "Insert waypoint here"
    // (trip) or "Edit tour" (displayed tour) — NOTHING is inserted
    // automatically.
    if (!this.pickMode) {
      this._showSearchPopup(e.lngLat, { onRoute: this._clickHitRoute(e.point) });
      return;
    }
    if (!this.trip) return;
    const t = this.trip;
    const { lng, lat } = e.lngLat;
    // Set accommodation on the map (own mode, not a waypoint).
    if (this.pickMode === "startAccommodation") {
      this._setAccommodationCoordOn(t, this._startAccHolder(t), lng, lat);
      return;
    }
    if (this.pickMode.startsWith(STAGE_ACC_PREFIX)) {
      const stage = t.stages.find((s) => s.id === this.pickMode.slice(STAGE_ACC_PREFIX.length));
      if (stage) this._setAccommodationCoordOn(t, this._stageAccHolder(t, stage), lng, lat);
      else {
        this.pickMode = null;
        this._setBanner("");
      }
      return;
    }
    const name = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const wp = Trips.makeWaypoint({ name, latitude: lat, longitude: lng });
    if (this.pickMode === "start") t.startWaypoint = wp;
    else if (this.pickMode === "end") t.endWaypoint = wp;
    else if (this.pickMode === "stop") t.intermediateStops.push(wp);
    this.pickMode = null;
    this._setBanner("");
    this.store.touch();
    this.renderDetail();
    this.tripOffcanvas.show();

    // Load the place name via reverse geocoding (the coordinate is visible immediately).
    reverseGeocode(lat, lng).then((placeName) => {
      if (placeName) {
        wp.name = placeName;
        this.store.touch();
        if (this.trip === t) this.renderDetail();
      }
    });
  }

  // Access capsule for an accommodation (start/stage): get/set + pick mode +
  // search bias. This lets the map pick and the search field share one implementation.
  _startAccHolder(t) {
    return {
      get: () => t.startAccommodation,
      set: (a) => {
        t.startAccommodation = Trips.accommodationIsEmpty(a) ? null : a;
      },
      pickMode: "startAccommodation",
      bias: () => this._accBias(t, t.startAccommodation),
    };
  }

  _stageAccHolder(t, stage) {
    return {
      get: () => stage.accommodation,
      set: (a) => {
        stage.accommodation = Trips.accommodationIsEmpty(a) ? null : a;
      },
      pickMode: `${STAGE_ACC_PREFIX}${stage.id}`,
      bias: () => this._accBias(t, stage.accommodation),
    };
  }

  /** Search bias center of an accommodation: own coordinate, otherwise trip start. */
  _accBias(t, acc) {
    if (acc && acc.latitude != null && acc.longitude != null) return [acc.longitude, acc.latitude];
    if (t.startWaypoint) return [t.startWaypoint.longitude, t.startWaypoint.latitude];
    return null;
  }

  // --- Stage route / distance (like iOS TripStageEditScreen) ----------------

  /** Splits a stage title "Start – Destination" into both place names (or null). */
  _titlePlaces(title) {
    const parts = String(title || "").split(" – ").map((s) => s.trim());
    if (parts.length >= 2 && parts[0] && parts[parts.length - 1]) {
      return { start: parts[0], end: parts[parts.length - 1] };
    }
    return null;
  }

  /**
   * Display names for START and DESTINATION of a stage (for checking in the side menu).
   * Source without extra geocoding calls: the stage title "A – B"; falling back
   * for the first/last stage to the trip start or destination waypoint. Unknown → "".
   */
  /**
   * Updates the cost display (accommodations/expenses/total cost + header
   * tile) IN PLACE — without renderDetail, so that focus is not lost while
   * typing in the price/amount field.
   */
  _updateCostSummary(t) {
    const set = (sel, val) => {
      const el = this.detailEl?.querySelector(sel);
      if (el) el.textContent = money(val);
    };
    set("#cost-acc", Trips.accommodationCostTotal(t));
    set("#cost-exp", Trips.expensesTotal(t));
    set("#cost-total", Trips.totalCost(t));
    set("#summary-cost", Trips.totalCost(t));
  }

  /**
   * Place/city for a coordinate (gray below start/destination/waypoints). The result
   * is determined ONCE per coordinate via reverse geocoding and cached; the
   * requests run sequentially with ~1 s spacing (Nominatim limit). Returns ""
   * while unknown; a hit triggers a batched re-render.
   */
  _localityFor(lng, lat) {
    if (lng == null || lat == null || Number.isNaN(+lng) || Number.isNaN(+lat)) return "";
    if (!this._localityCache) this._localityCache = new Map();
    const key = `${(+lat).toFixed(4)},${(+lng).toFixed(4)}`;
    if (this._localityCache.has(key)) return this._localityCache.get(key);
    this._localityCache.set(key, ""); // "pending" → no duplicate request
    (this._localityQueue = this._localityQueue || []).push([key, +lat, +lng]);
    this._drainLocalityQueue();
    return "";
  }

  async _drainLocalityQueue() {
    if (this._localityDraining) return;
    this._localityDraining = true;
    while (this._localityQueue && this._localityQueue.length) {
      const [key, lat, lng] = this._localityQueue.shift();
      const name = await reverseGeocode(lat, lng);
      this._localityCache.set(key, name || "");
      if (name) {
        if (this._localityTimer) clearTimeout(this._localityTimer);
        this._localityTimer = setTimeout(() => {
          this._localityTimer = null;
          this.renderDetail();
        }, 400);
      }
      await new Promise((r) => setTimeout(r, 1100)); // ~1 request/s
    }
    this._localityDraining = false;
  }

  _stageEndpoints(t, stage, idx) {
    if (!t) return { start: "", end: "" };
    const places = this._titlePlaces(stage.title);
    const start = (places && places.start) || (idx === 0 && t.startWaypoint ? t.startWaypoint.name : "") || "";
    const end = (places && places.end) || (idx === t.stages.length - 1 && t.endWaypoint ? t.endWaypoint.name : "") || "";
    return { start, end };
  }

  /**
   * Start/destination anchors of a stage — like iOS: the title "A – B" is authoritative;
   * otherwise as a fallback the trip start (first stage) or the trip destination
   * (last stage). Each anchor is { place } (to be geocoded) or { coord }.
   */
  _stageAnchors(t, stage) {
    const idx = t.stages.findIndex((s) => s.id === stage.id);
    const places = this._titlePlaces(stage.title);
    const wp = (w) => (w ? { coord: [w.longitude, w.latitude] } : null);
    // Start: prefer the END of the previous stage (gapless trip, no
    // re-geocoding), otherwise from the title or the trip start waypoint.
    let start = null;
    if (idx > 0) {
      const prev = t.stages[idx - 1];
      const ride = prev.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(prev.plannedRouteRef.rideId) : null;
      if (ride && ride.samples.length) {
        const last = ride.samples[ride.samples.length - 1];
        start = { coord: [last.longitude, last.latitude] };
      }
    }
    if (!start) start = places ? { place: places.start } : idx === 0 ? wp(t.startWaypoint) : null;
    const end = places ? { place: places.end } : idx === t.stages.length - 1 ? wp(t.endWaypoint) : null;
    return { start, end };
  }

  /** Resolves an anchor to [lng,lat] (place name → geocoding, once on tap). */
  async _resolveAnchor(anchor) {
    if (!anchor) return null;
    if (anchor.coord) return anchor.coord;
    const res = await searchPlaces(anchor.place, 1);
    return res.length ? [res[0].lon, res[0].lat] : null;
  }

  /**
   * Connector piece (deviation from the template) from a → b via the routing
   * provider. If b is close to a (≤ threshold), it counts as "on the template" → []
   * (no connector needed). If routing fails, a straight line [a, b] as fallback.
   */
  async _connector(a, b) {
    const GAP_M = 120; // a smaller distance counts as directly on the template
    if (haversineMeters(a, b) <= GAP_M) return [];
    const r = await computeRoute(this.routingConfig, [
      { longitude: a[0], latitude: a[1] },
      { longitude: b[0], latitude: b[1] },
    ]);
    return r && r.coordinates && r.coordinates.length >= 2 ? r.coordinates : [a, b];
  }

  /**
   * Route between two points [lng,lat]. If there is a trip template (red tour),
   * the route follows ALONG the template — but deviates at the ends when start
   * or destination lie BESIDE the template (typical: an overnight stay off the route).
   * Result = [connector start→template] + [template slice] + [connector
   * template→destination]. Without a template, freely via the provider. Returns
   * { coordinates, distanceMeters } or null on failure.
   */
  /**
   * Removes out-and-back loops from a coordinate sequence: if the path returns
   * close to a point visited shortly before (same way there and back), the
   * intervening bulge is discarded. Prevents the "lollipop" loop when connecting
   * to the template. [lng,lat][] → cleaned [lng,lat][].
   */
  _dedupeBacktrack(coords) {
    if (!coords || coords.length < 4) return coords || [];
    const TH = 25; // m: this close counts as "back at the same point"
    const WIN = 120; // how far back to search (short connector loops)
    const out = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
      const p = coords[i];
      let loopAt = -1;
      for (let j = out.length - 2; j >= Math.max(0, out.length - WIN); j--) {
        if (haversineMeters(out[j], p) < TH) {
          loopAt = j;
          break;
        }
      }
      if (loopAt >= 0) out.length = loopAt + 1; // clip the bulge
      out.push(p);
    }
    return out;
  }

  async _routeBetween(t, from, to, opts = {}) {
    // opts.ignoreTemplate = true → ignore the template entirely, shortest route.
    const template = opts.ignoreTemplate ? [] : this._templateCoords(t);
    if (template.length >= 2) {
      const fi = nearestIndex(template, from);
      const ti = nearestIndex(template, to);
      // Template slice in travel direction (from side → to side).
      const slice = fi <= ti ? template.slice(fi, ti + 1) : template.slice(ti, fi + 1).reverse();
      if (slice.length >= 2) {
        const head = slice[0];
        const tail = slice[slice.length - 1];
        const startLeg = await this._connector(from, head); // actual start → template
        const endLeg = await this._connector(tail, to); // template → actual destination
        // Avoid duplicate transition points (head/tail).
        const raw = [...(startLeg.length ? startLeg.slice(0, -1) : []), ...slice, ...(endLeg.length ? endLeg.slice(1) : [])];
        // Remove loops: if the route from the accommodation first runs a bit up
        // along the template and back the same way, the outlier is clipped
        // → the template is followed from the touch point only toward the destination.
        const coords = this._dedupeBacktrack(raw);
        if (coords.length >= 2) return { coordinates: coords, distanceMeters: routeLength(coords) };
      }
    }
    const r = await computeRoute(this.routingConfig, [
      { longitude: from[0], latitude: from[1] },
      { longitude: to[0], latitude: to[1] },
    ]);
    if (!r || !r.coordinates || r.coordinates.length < 2) return null;
    return { coordinates: r.coordinates, distanceMeters: r.distanceMeters || routeLength(r.coordinates) };
  }

  /**
   * Routes a point sequence [start, via1, …, viaN, destination] leg by leg via
   * _routeBetween (each leg template-faithful with deviation) and joins the pieces
   * together. This way the stage passes through explicitly set intermediate stops — and
   * deviates from the template there to do so. null if a leg fails.
   */
  async _routeStageThrough(t, points, legDirect = []) {
    let coordinates = [];
    let distanceMeters = 0;
    for (let i = 0; i < points.length - 1; i++) {
      // Decide per leg: follow the template or go direct (shortest route).
      const res = await this._routeBetween(t, points[i], points[i + 1], { ignoreTemplate: !!legDirect[i] });
      if (!res) return null;
      coordinates = coordinates.length ? coordinates.concat(res.coordinates.slice(1)) : res.coordinates.slice();
      distanceMeters += res.distanceMeters;
    }
    return coordinates.length >= 2 ? { coordinates, distanceMeters } : null;
  }

  /** Intermediate stops of the stage as [lng,lat][] (in the order set). */
  _stageViaCoords(stage) {
    return (stage.waypoints || []).map((w) => [w.longitude, w.latitude]);
  }

  /**
   * Per-leg "direct" flags of a stage for the point sequence [start, via…, destination]:
   * leg into each via = via.directIn, last leg (→ destination) = stage.directToEnd.
   */
  _stageLegDirect(stage) {
    return [...(stage.waypoints || []).map((w) => !!w.directIn), !!stage.directToEnd];
  }

  /** Toggles leg `li` of a stage between "follow template" and "direct". */
  _toggleStageLeg(stage, li) {
    const vias = stage.waypoints || [];
    if (li < vias.length) vias[li].directIn = !vias[li].directIn;
    else stage.directToEnd = !stage.directToEnd;
  }

  /**
   * Computes the route of a stage (start → intermediate stops → destination) and stores it
   * as a planned RideSession → the distance derives from the route.
   */
  async _computeStageRoute(t, stage) {
    const { start, end } = this._stageAnchors(t, stage);
    const s = await this._resolveAnchor(start);
    const e = await this._resolveAnchor(end);
    if (!s || !e) {
      alert(tr("Start/Ziel der Etappe nicht auflösbar. Benenne die Etappe als Start – Ziel."));
      this.renderDetail();
      return;
    }
    const res = await this._routeStageThrough(t, [s, ...this._stageViaCoords(stage), e], this._stageLegDirect(stage));
    if (!res) {
      alert(tr("Routing fehlgeschlagen."));
      this.renderDetail();
      return;
    }
    // Replace the existing stage route.
    if (stage.plannedRouteRef && this.ridesStore) this.ridesStore.removeRides([stage.plannedRouteRef.rideId]);
    const ride = plannedRideFromCoords(res.coordinates, {
      title: stage.title,
      distanceMeters: res.distanceMeters,
      transportMode: t.transportMode || "cycling",
    });
    this.ridesStore.upsertRide(ride);
    stage.plannedRouteRef = { rideId: ride.id };
    this.store.touch();
    this.renderDetail();
    this.renderMap();
  }

  /**
   * Start point of a stage [lng,lat] + name: end of the previous stage with a
   * route, otherwise the trip start (located start accommodation or start waypoint).
   */
  _stageStartPoint(t, stage) {
    const idx = t.stages.findIndex((s) => s.id === stage.id);
    if (idx > 0) {
      const prev = t.stages[idx - 1];
      const ride = prev.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(prev.plannedRouteRef.rideId) : null;
      if (ride && ride.samples.length) {
        const last = ride.samples[ride.samples.length - 1];
        return { coord: [last.longitude, last.latitude], name: this._destName(prev.title) || tr("Start") };
      }
    }
    const acc = t.startAccommodation;
    if (acc && acc.latitude != null && acc.longitude != null) return { coord: [acc.longitude, acc.latitude], name: acc.name || tr("Start") };
    if (t.startWaypoint) return { coord: [t.startWaypoint.longitude, t.startWaypoint.latitude], name: t.startWaypoint.name || tr("Start") };
    return null;
  }

  /**
   * Sets a map/search result as the destination of the selected stage: routes from
   * the stage start (see _stageStartPoint, template-faithful via _routeBetween) here,
   * names the stage "Start – Place" and adopts an accommodation if the destination
   * is one (like the guided planner).
   */
  async _setStageDestination(stage, r) {
    const t = this.trip;
    if (!t) return;
    const start = this._stageStartPoint(t, stage);
    if (!start) {
      alert(tr("Kein Etappenstart bestimmbar (Start-Unterkunft/Startpunkt setzen)."));
      return;
    }
    const res = await this._routeStageThrough(t, [start.coord, ...this._stageViaCoords(stage), [r.lon, r.lat]], this._stageLegDirect(stage));
    if (!res) {
      alert(tr("Routing fehlgeschlagen."));
      return;
    }
    stage.title = `${start.name} – ${r.name || tr("Ziel")}`;
    if (stage.plannedRouteRef && this.ridesStore) this.ridesStore.removeRides([stage.plannedRouteRef.rideId]);
    const ride = plannedRideFromCoords(res.coordinates, { title: stage.title, distanceMeters: res.distanceMeters, transportMode: t.transportMode || "cycling" });
    this.ridesStore.upsertRide(ride);
    stage.plannedRouteRef = { rideId: ride.id };
    if (this._isAccommodationCandidate(r)) {
      stage.accommodation = Trips.makeAccommodation({
        name: r.name || "",
        address: addressLine(r.name, r.displayName) || r.displayName || "",
        latitude: r.lat,
        longitude: r.lon,
      });
    }
    this.store.touch();
    this._clearSearch();
    this.renderDetail();
    this.renderMap();
    this.tripOffcanvas.show();
  }

  // --- Guided stage planner "Next stage" (port of iOS TripGuidedPlanning) -----

  /** Cursor = start of the next stage: end of the last stage with a route, otherwise trip start. */
  _guidedCursor(t) {
    for (let i = t.stages.length - 1; i >= 0; i--) {
      const s = t.stages[i];
      const ride = s.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(s.plannedRouteRef.rideId) : null;
      if (ride && ride.samples.length) {
        const last = ride.samples[ride.samples.length - 1];
        return { coord: [last.longitude, last.latitude], name: this._destName(s.title) || "Start" };
      }
    }
    // No stages yet: the trip begins at the located start accommodation (first
    // overnight stay) — takes precedence over the start waypoint.
    const acc = t.startAccommodation;
    if (acc && acc.latitude != null && acc.longitude != null) {
      return { coord: [acc.longitude, acc.latitude], name: acc.name || "Start" };
    }
    if (t.startWaypoint) return { coord: [t.startWaypoint.longitude, t.startWaypoint.latitude], name: t.startWaypoint.name || "Start" };
    return null;
  }

  /** Destination name from a stage title "A – B" (= B), otherwise null. */
  _destName(title) {
    const p = this._titlePlaces(title);
    return p ? p.end : null;
  }

  /** Mandatory intermediate stops not yet reached by any stage (endpoint ≤ 250 m). */
  _unreachedStops(t) {
    const tol = 250;
    return t.intermediateStops.filter(
      (stop) =>
        !t.stages.some((s) => {
          const ride = s.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(s.plannedRouteRef.rideId) : null;
          const last = ride && ride.samples.length ? ride.samples[ride.samples.length - 1] : null;
          return last && haversineMeters([last.longitude, last.latitude], [stop.longitude, stop.latitude]) <= tol;
        }),
    );
  }

  /** Updates the "from: <place>" line in the guided planner. */
  _updateGuidedCursorLabel() {
    const el = document.getElementById("guided-cursor");
    if (!el) return;
    const t = this.trip;
    const cur = t && this._guidedCursor(t);
    el.textContent = cur ? `${tr("Nächste Etappe ab")}: ${cur.name}` : tr("Kein Startpunkt — setze zuerst einen Reisestart.");
  }

  /** Opens the guided planner. */
  _openGuided() {
    if (!this.trip) return;
    const results = document.getElementById("guided-results");
    const status = document.getElementById("guided-status");
    if (results) results.innerHTML = "";
    if (status) status.textContent = "";
    // Reset the cities section too (otherwise old hits remain).
    const cities = document.getElementById("guided-cities");
    const citiesStatus = document.getElementById("guided-cities-status");
    if (cities) cities.innerHTML = "";
    if (citiesStatus) citiesStatus.textContent = "";
    this._updateGuidedCursorLabel();
    this.guidedModal.show();
  }

  /**
   * Searches for destinations around the desired distance: mandatory stops (always), snap POIs of
   * the configured stage destinations (in the band 0.6…1.4×) and a few places (ring via
   * reverse geocoding). Ranking/limiting via gc/guided (pure, tested).
   */
  async _runGuidedSearch() {
    const t = this.trip;
    const cur = t && this._guidedCursor(t);
    const results = document.getElementById("guided-results");
    const status = document.getElementById("guided-status");
    if (!cur) {
      if (status) status.textContent = tr("Kein Startpunkt — setze zuerst einen Reisestart.");
      return;
    }
    const desired = Math.max(1, parseFloat(document.getElementById("guided-distance").value) || 60) * 1000;
    if (status) status.textContent = tr("Suche Ziele …");
    if (results) results.innerHTML = "";
    // Immediately remove the city hits from a previous search.
    const citiesBox = document.getElementById("guided-cities");
    const citiesStatus = document.getElementById("guided-cities-status");
    if (citiesBox) citiesBox.innerHTML = "";
    if (citiesStatus) citiesStatus.textContent = "";

    const found = [];
    // Next mandatory stop (always offered, at the top).
    const nextStop = this._unreachedStops(t)[0];
    if (nextStop) {
      found.push({
        name: nextStop.name || tr("Stopp"),
        category: tr("Pflicht-Stopp"),
        coord: [nextStop.longitude, nextStop.latitude],
        distanceMeters: haversineMeters(cur.coord, [nextStop.longitude, nextStop.latitude]),
        mandatory: true,
      });
    }

    // Search center: if there is a template, determine a point ~the desired distance AHEAD on
    // the template (in travel direction) and search there — otherwise around the
    // cursor (360° ring). This way "Next stage" finds destinations along the trip/tour.
    const ahead = this._templateAheadPoint(t, cur.coord, desired);
    const corridor = !!ahead;
    const searchCenter = ahead || cur.coord;
    const corridorRadiusM = desired * 0.45; // tolerance sideways/along the template

    // Snap POIs (stage destinations): only active ones; one radius search per category.
    const cats = loadPOIs("snap").filter((c) => c.enabled !== false);
    const radiusDeg = corridor ? Math.min(1, corridorRadiusM / 111000 + 0.02) : Math.min(2, (desired * 1.4) / 111000 + 0.05);
    const poiBatches = await Promise.all(cats.map((c) => searchNear(poiLabel(c.query), searchCenter, 10, { bounded: true, radiusDeg })));
    cats.forEach((c, i) => {
      for (const r of poiBatches[i]) {
        const dCur = haversineMeters(cur.coord, [r.lon, r.lat]);
        // Corridor: close to the ahead point (travel direction). Otherwise: filter onto
        // the distance band around the desired distance (ring mode).
        const keep = corridor ? haversineMeters(ahead, [r.lon, r.lat]) <= corridorRadiusM : withinBand(dCur, desired);
        if (keep) {
          found.push({ name: r.name, address: r.displayName, category: poiLabel(c.query), coord: [r.lon, r.lat], distanceMeters: dCur, mandatory: false, osmCategory: r.osmCategory, osmType: r.osmType });
        }
      }
    });

    // Name places (reverse geocoding): in the corridor two points ALONG the
    // template (in travel direction), otherwise four ring points around the cursor.
    const probePoints = corridor
      ? [this._templateAheadPoint(t, cur.coord, desired * 0.7), ahead].filter(Boolean)
      : [0, 90, 180, 270].map((bearing) => destinationPoint(cur.coord, desired, bearing));
    const probes = await Promise.all(
      probePoints.map((p) => reverseGeocode(p[1], p[0]).then((name) => (name ? { name, coord: p } : null))),
    );
    for (const city of probes) {
      if (city) {
        found.push({
          name: city.name,
          category: tr("Ort"),
          coord: city.coord,
          distanceMeters: haversineMeters(cur.coord, city.coord),
          mandatory: false,
        });
      }
    }

    // With a template present: distance ALONG the template instead of the straight
    // line — for both ranking and display. (e.g. Schweinfurt→Würzburg along the Main
    // cycle path ~95 km instead of ~36 km straight line.) Without a template it stays
    // the straight line.
    if (corridor) {
      for (const c of found) {
        const along = this._alongTemplateMeters(t, cur.coord, c.coord);
        if (along != null) c.distanceMeters = along;
      }
    }

    const ranked = rankCandidates(found, desired);
    if (status) {
      status.textContent = ranked.length
        ? `${ranked.length} ${tr("Ziele um")} ${Math.round(desired / 1000)} km`
        : tr("Keine Ziele gefunden — andere Distanz testen oder Etappen-Ziele in den Einstellungen pflegen.");
    }
    if (results) {
      results.innerHTML = ranked
        .map((c, i) => {
          // Address without the leading name (otherwise duplicated).
          const addrText = addressLine(c.name, c.address);
          const addr = addrText
            ? `<div class="small text-secondary text-truncate" title="${esc(c.address)}">📍 ${esc(addrText)}</div>`
            : "";
          // Deviation from the template (only when a template is assigned).
          const dTmpl = this._distanceToTemplateMeters(t, c.coord);
          const tmplLine = dTmpl != null
            ? `<div class="small text-secondary">↧ ${fmtDistance(dTmpl)} ${tr("zur Vorlage")}</div>`
            : "";
          return `<button type="button" class="list-group-item list-group-item-action" data-cand="${i}">
            <div class="d-flex justify-content-between align-items-start gap-2">
              <span class="fw-semibold">${c.mandatory ? "🏁 " : ""}${esc(c.name)}</span>
              <span class="badge text-bg-primary flex-shrink-0">${fmtDistance(c.distanceMeters)}</span>
            </div>
            <div class="small text-secondary">${esc(c.category)}</div>
            ${addr}
            ${tmplLine}
          </button>`;
        })
        .join("");
      results.querySelectorAll("[data-cand]").forEach((el) =>
        el.addEventListener("click", () => this._chooseGuided(ranked[Number(el.dataset.cand)])),
      );
    }

    // Additionally: the largest places with population nearby (Overpass).
    // Runs asynchronously in the background — the target list above stays usable.
    const cityRadius = Math.min(80000, Math.max(desired * 0.6, 25000));
    this._loadGuidedCities(searchCenter, cityRadius, cur, t);
  }

  /**
   * Loads the largest places (with population) around `center` and renders them
   * as an additional, clickable list in the "Next stage" dialog. Each city shows
   * its population, straight-line distance from the cursor and — if a template
   * exists — the deviation from the template. A click selects it like a normal
   * destination (`_chooseGuided`). Graceful: a status message on error/empty.
   */
  async _loadGuidedCities(center, radius, cur, t) {
    const box = document.getElementById("guided-cities");
    const status = document.getElementById("guided-cities-status");
    if (!box) return;
    box.innerHTML = "";
    if (status) status.textContent = tr("Städte werden gesucht …");
    let cities = null;
    try {
      cities = await largestCities(center, { radius });
    } catch {
      cities = null;
    }
    if (cities === null) {
      if (status) status.textContent = tr("Städte-Dienst nicht erreichbar.");
      return;
    }
    if (!cities.length) {
      if (status) status.textContent = tr("Keine Städte mit Einwohnerzahl gefunden.");
      return;
    }
    if (status) status.textContent = `${tr("Größte Städte in der Nähe")}:`;
    // Population with thousands separators in the UI language.
    const nf = new Intl.NumberFormat(navigator.language || "de");
    const candidates = cities.map((c) => {
      const coord = [c.lon, c.lat];
      // With a template: distance along the template (ridden distance), else straight line.
      const along = this._alongTemplateMeters(t, cur.coord, coord);
      return {
        name: c.name,
        category: tr("Stadt"),
        coord,
        distanceMeters: along != null ? along : haversineMeters(cur.coord, coord),
        mandatory: false,
      };
    });
    box.innerHTML = cities
      .map((c, i) => {
        const dTmpl = this._distanceToTemplateMeters(t, [c.lon, c.lat]);
        const tmplLine = dTmpl != null
          ? `<div class="small text-secondary">↧ ${fmtDistance(dTmpl)} ${tr("zur Vorlage")}</div>`
          : "";
        const popLine = c.population != null ? `👥 ${nf.format(c.population)} ${tr("Einwohner")}` : "—";
        return `<button type="button" class="list-group-item list-group-item-action" data-city="${i}">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <span class="fw-semibold">🏙 ${esc(c.name)}</span>
            <span class="badge text-bg-primary flex-shrink-0">${fmtDistance(candidates[i].distanceMeters)}</span>
          </div>
          <div class="small text-secondary">${popLine}</div>
          ${tmplLine}
        </button>`;
      })
      .join("");
    box.querySelectorAll("[data-city]").forEach((el) =>
      el.addEventListener("click", () => this._chooseGuided(candidates[Number(el.dataset.city)])),
    );
  }

  /** True if the candidate is accommodation according to the OSM classification. */
  _isAccommodationCandidate(c) {
    return !!(c && c.osmCategory === "tourism" && ACCOMMODATION_OSM_TYPES.has(c.osmType));
  }

  /** Picks a destination: routes cursor → destination, creates the stage, advances the cursor. */
  async _chooseGuided(candidate) {
    const t = this.trip;
    const cur = t && this._guidedCursor(t);
    if (!t || !cur || !candidate) return;
    const status = document.getElementById("guided-status");
    if (status) status.textContent = tr("Route wird berechnet …");
    // Like "Compute route": if a template exists, the stage follows it
    // (trimmed between cursor and chosen destination); otherwise routed freely.
    const res = await this._routeBetween(t, cur.coord, candidate.coord);
    if (!res) {
      if (status) status.textContent = tr("Routing fehlgeschlagen.");
      return;
    }
    const title = `${cur.name} – ${candidate.name}`;
    const ride = plannedRideFromCoords(res.coordinates, {
      title,
      distanceMeters: res.distanceMeters,
      transportMode: t.transportMode || "cycling",
    });
    this.ridesStore.upsertRide(ride);
    const stage = Trips.makeStage({ title });
    stage.plannedRouteRef = { rideId: ride.id };
    // If the chosen destination is accommodation (OSM tourism=hotel/guest_house/…),
    // adopt its details straight into the stage accommodation (name/address/
    // position) — saves the user from searching again.
    if (this._isAccommodationCandidate(candidate)) {
      stage.accommodation = Trips.makeAccommodation({
        name: candidate.name || "",
        address: addressLine(candidate.name, candidate.address) || candidate.address || "",
        latitude: candidate.coord[1],
        longitude: candidate.coord[0],
      });
    }
    t.stages.push(stage);
    this.store.touch();
    // Activate the NEW stage right away (select + highlight): a click on the map
    // then offers "As stage destination" — you can move the stage's destination to
    // an alternative (e.g. a hotel) without selecting the stage in the list first.
    // _selectStage renders detail + map (deliberately without re-centering).
    this._selectStage(stage);
    // Then deliberately fit to the NEW stage (cursor → chosen destination) so the
    // camera ends up at the destination.
    this._fitToCoords(res.coordinates);
    // After the selection: close the guided planner and show the trip detail (right
    // sidebar) so the newly created (active) stage can be edited first. On reopening,
    // _openGuided sets cursor/list freshly.
    this.guidedModal.hide();
    this.tripOffcanvas.show();
  }

  /** Sets the coordinate of an accommodation (start/stage) via map tap + fills empty fields. */
  _setAccommodationCoordOn(t, holder, lng, lat) {
    const acc = holder.get() || Trips.makeAccommodation({});
    acc.latitude = lat;
    acc.longitude = lng;
    holder.set(acc);
    this.pickMode = null;
    this._setBanner("");
    this.store.touch();
    this.renderDetail();
    this.renderMap();
    this.tripOffcanvas.show();
    // Backfill the address via reverse geocoding if name + address are still empty.
    reverseGeocode(lat, lng).then((placeName) => {
      const a = holder.get();
      if (placeName && a && !a.name && !a.address && this.trip === t) {
        a.address = placeName;
        this.store.touch();
        this.renderDetail();
      }
    });
  }

  /**
   * Wires up the search/map control of an accommodation within
   * `scopeEl` (detail root = start, stage card = stage). `holder` encapsulates
   * access/pick mode/bias (see _startAccHolder/_stageAccHolder).
   */
  _wireAccSearch(scopeEl, holder) {
    if (!scopeEl) return;
    const input = scopeEl.querySelector("[data-acc-search]");
    if (!input) return;
    const box = scopeEl.querySelector("[data-acc-search-results]");
    const run = async () => {
      box.innerHTML = `<div class="text-secondary small px-1">${tr("Suche …")}</div>`;
      const c = holder.bias(); // prefer results near the trip region, otherwise global
      const results = c ? await searchNear(input.value, c, 6) : await searchPlaces(input.value, 6);
      if (!results.length) {
        box.innerHTML = `<div class="text-secondary small px-1">Keine Treffer.</div>`;
        return;
      }
      box.innerHTML = results
        .map((r, i) => {
          const addr = addressLine(r.name, r.displayName);
          return `<button type="button" class="list-group-item list-group-item-action py-1 px-2 text-start" data-acc-res="${i}">
            <div class="small fw-semibold text-truncate">${esc(r.name)}</div>
            ${addr ? `<div class="small text-secondary text-truncate">${esc(addr)}</div>` : ""}
          </button>`;
        })
        .join("");
      box.querySelectorAll("[data-acc-res]").forEach((el) =>
        el.addEventListener("click", () => {
          const r = results[Number(el.dataset.accRes)];
          const acc = holder.get() || Trips.makeAccommodation({});
          if (!acc.name) acc.name = r.name; // keep the name entered by the user
          acc.address = r.displayName;
          acc.latitude = r.lat;
          acc.longitude = r.lon;
          holder.set(acc);
          this.store.touch();
          this.renderDetail();
          this.renderMap();
        }),
      );
    };
    scopeEl.querySelector("[data-acc-search-btn]")?.addEventListener("click", run);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        run();
      }
    });
    scopeEl.querySelector("[data-acc-pick]")?.addEventListener("click", () => this._startPick(holder.pickMode));
    scopeEl.querySelector("[data-acc-clear-coord]")?.addEventListener("click", () => {
      const acc = holder.get();
      if (!acc) return;
      if (!confirm(tr("Position entfernen?"))) return;
      acc.latitude = null;
      acc.longitude = null;
      holder.set(acc);
      this.store.touch();
      this.renderDetail();
      this.renderMap();
    });
  }

  _setBanner(text) {
    if (!this.bannerEl) return;
    this.bannerEl.textContent = text;
    this.bannerEl.classList.toggle("d-none", !text);
    // Keep the mode pill in sync with the pick banner: it yields to the banner
    // during a map pick and reappears afterward.
    this._renderTripModeIndicator();
  }

  // --- Global place/POI search (navbar + map tap) ---------------------------

  /** Wires up the navbar search field (Enter/button) + "Clear". */
  _wireNavSearch() {
    const input = document.getElementById("nav-search");
    if (!input) return;
    const go = () => this.runSearch(input.value);
    document.getElementById("nav-search-btn")?.addEventListener("click", go);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        go();
      } else if (e.key === "Escape") {
        document.getElementById("nav-search-results")?.classList.add("d-none");
      }
    });
    // Click/focus into the (empty) search field → overlay with the last search results.
    input.addEventListener("focus", () => this._showRecentSearch());
    // Hide the history overlay while typing (otherwise it shows stale results);
    // when the field is cleared again, the history reappears.
    input.addEventListener("input", () => {
      if (input.value.trim()) document.getElementById("nav-search-results")?.classList.add("d-none");
      else this._showRecentSearch();
    });
    input.addEventListener("blur", () => {
      // Close with a delay so that a click on a result still registers. Only
      // the "Recently searched" overlay (empty field) is closed this way — a
      // real result list stays open as before.
      if (input.value.trim()) return;
      setTimeout(() => {
        if (document.activeElement !== input && !input.value.trim()) {
          document.getElementById("nav-search-results")?.classList.add("d-none");
        }
      }, 200);
    });
    document.getElementById("nav-search-clear")?.addEventListener("click", () => {
      input.value = "";
      this._clearSearch();
    });
  }

  /** Half the edge length (in degrees) for a search box ≈ the currently visible map viewport. */
  _viewportRadiusDeg() {
    const b = this.map.getBounds();
    const dLng = Math.abs(b.getEast() - b.getWest());
    const dLat = Math.abs(b.getNorth() - b.getSouth());
    // half the larger span; clamp against extreme cases (very near/very far).
    return Math.min(2, Math.max(0.01, Math.max(dLng, dLat) / 2));
  }

  /**
   * Runs a place search and shows the results as a list (below the navbar)
   * + markers on the map. Center = `center` OR a point set via "Search here"
   * OR the current map center.
   *
   * `bounded:false` (free text) = only a bias toward proximity, distant places are still
   * found; `bounded:true` (POI quick targets / "Search here") = strictly limited to the
   * visible map viewport.
   */
  async runSearch(query, center, { bounded = false } = {}) {
    const q = (query || "").trim();
    const box = document.getElementById("nav-search-results");
    if (!q) {
      this._clearSearch();
      return;
    }
    if (!center) {
      if (this.searchCenter) {
        center = this.searchCenter;
        bounded = true; // "Search here" → strictly within the visible viewport, not global
      } else {
        const c = this.map.getCenter();
        center = [c.lng, c.lat];
      }
    }
    this.searchCenter = null; // takes effect only once
    if (box) {
      box.classList.remove("d-none");
      box.innerHTML = `<div class="text-secondary small p-2">${tr("Suche …")}</div>`;
    }
    // Put the bounded search onto the currently visible viewport (instead of the fixed
    // default box) so that "in the map viewport" really holds.
    const opts = bounded ? { bounded: true, radiusDeg: this._viewportRadiusDeg() } : { bounded };
    const results = await searchNear(q, center, 8, opts);
    // Annotate the distance to the search center (for display) and sort quick targets
    // (radius search) by distance — nearest first.
    if (center) {
      for (const r of results) r.distanceM = haversineMeters(center, [r.lon, r.lat]);
      if (bounded) results.sort((a, b) => a.distanceM - b.distanceM);
    }
    this._renderSearchResults(results, box);
  }

  /**
   * Renders the result list (with "fly to" + optional start/destination/stop).
   *
   * `withMarkers=false` → only the list, without map markers (for the "Recently
   * searched" overlay when focusing). `recent=true` shows a header and does
   * NOT overwrite the saved history (otherwise merely re-displaying it would save
   * the list again "as the last search").
   */
  _renderSearchResults(results, box, { withMarkers = true, recent = false } = {}) {
    if (withMarkers) this._setSearchMarkers(results);
    if (!box) return;
    box.classList.remove("d-none");
    if (!results.length) {
      box.innerHTML = `<div class="text-secondary small p-2">${tr("Keine Treffer.")}</div>`;
      return;
    }
    // Remember the last search results for the focus overlay. The distance is NOT
    // saved along (it would be stale at the next focus relative to a different
    // center).
    if (!recent) {
      this.lastResults = results.map((r) => {
        const copy = { ...r };
        delete copy.distanceM;
        return copy;
      });
      this._saveRecentSearch(this.lastResults);
    }
    const hasTrip = !!this.trip;
    const header = recent
      ? `<div class="list-group-item py-1 px-2 small text-secondary bg-body-tertiary">${tr("Zuletzt gesucht")}</div>`
      : "";
    box.innerHTML =
      header +
      results
        .map((r, i) => {
          const addr = addressLine(r.name, r.displayName);
          const dist = typeof r.distanceM === "number" ? `<span class="fw-semibold">${fmtDistance(r.distanceM)}</span>` : "";
          const sub = dist && addr ? `${dist} · ${esc(addr)}` : `${dist}${esc(addr)}`;
          return `<div class="list-group-item py-1 px-2">
            <div class="d-flex align-items-center gap-1">
              <button class="btn btn-link btn-sm p-0 text-start flex-grow-1 text-truncate text-decoration-none" data-go="${i}" title="${esc(r.displayName)}">${esc(r.name)}</button>
              ${hasTrip ? `<button class="btn btn-sm btn-outline-primary py-0 px-1" data-slot="stop" data-i="${i}" title="${tr("Als Zwischenstopp")}">+</button>` : ""}
            </div>
            ${sub ? `<div class="small text-secondary text-truncate">${sub}</div>` : ""}
          </div>`;
        })
        .join("");
    box.querySelectorAll("[data-go]").forEach((el) =>
      el.addEventListener("click", () => this._flyToResult(results[Number(el.dataset.go)])),
    );
    box.querySelectorAll("[data-slot]").forEach((el) =>
      el.addEventListener("click", () => this._assignResultToTrip(results[Number(el.dataset.i)], el.dataset.slot)),
    );
  }

  /** Sets (purple) markers for the search results; each with a popup (+ trip actions). */
  _setSearchMarkers(results) {
    this.searchMarkers.forEach((m) => m.remove());
    this.searchMarkers = [];
    for (const r of results) {
      // Clicking the result marker opens the detail modal (instead of a
      // small popup) — consistent with the trip waypoint markers.
      const marker = new maplibregl.Marker({ color: "#6f42c1", subpixelPositioning: true })
        .setLngLat([r.lon, r.lat])
        .addTo(this.map);
      const el = marker.getElement();
      el.style.cursor = "pointer";
      el.title = r.name || "Ort";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._showMarkerInfo({ kind: "place", result: r });
      });
      this.searchMarkers.push(marker);
    }
  }

  /**
   * Flies to a result, collapses the result list and shows the place in the
   * detail modal. The search markers remain on the map → the chosen
   * result stays visibly marked.
   */
  _flyToResult(r) {
    this.map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(this.map.getZoom(), 13) });
    // Collapse the result list (markers stay, content stays for reopening)
    // and clear the search field — a renewed click into the field then directly shows the
    // history ("Recently searched") instead of the old search term.
    document.getElementById("nav-search-results")?.classList.add("d-none");
    const input = document.getElementById("nav-search");
    if (input) input.value = "";
    this._showMarkerInfo({ kind: "place", result: r });
  }

  /** Adopts a result as start/destination/intermediate stop of the current trip. */
  _assignResultToTrip(r, slot) {
    const t = this.trip;
    if (!t) return;
    const wp = Trips.makeWaypoint({ name: r.name, latitude: r.lat, longitude: r.lon });
    if (slot === "stop") {
      this._addStopForPlanning(wp);
      return;
    }
    if (slot === "start") t.startWaypoint = wp;
    else if (slot === "end") t.endWaypoint = wp;
    this.store.touch();
    this.renderDetail();
    this.renderMap();
    this._clearSearch();
    this.tripOffcanvas.show();
  }

  /**
   * Enqueue an intermediate stop: if a stage is selected, the stop belongs to it —
   * it is added to stage.waypoints and the stage route is re-routed through it
   * (deviating from the template to do so). Otherwise a trip intermediate stop
   * (auto-stages / planning without a template).
   */
  _addStopForPlanning(wp) {
    const t = this.trip;
    if (!t) return;
    const selStage = this._selectedStageId ? t.stages.find((s) => s.id === this._selectedStageId) : null;
    this._clearSearch();
    if (selStage) {
      selStage.waypoints = selStage.waypoints || [];
      selStage.waypoints.push(wp);
      this.store.touch();
      this._recomputeStageWithVias(t, selStage);
      this.tripOffcanvas.show();
      return;
    }
    t.intermediateStops.push(wp);
    this.store.touch();
    this.renderDetail();
    this.renderMap();
    this.tripOffcanvas.show();
  }

  /**
   * Re-routes a stage through its intermediate stops. Start/destination come from the
   * EXISTING route (first/last point) — no re-geocoding — otherwise
   * from the anchors. Each leg is template-faithful with deviation (_routeStageThrough).
   */
  async _recomputeStageWithVias(t, stage) {
    const existing = stage.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(stage.plannedRouteRef.rideId) : null;
    let s;
    let e;
    if (existing && existing.samples.length >= 2) {
      s = [existing.samples[0].longitude, existing.samples[0].latitude];
      e = [existing.samples[existing.samples.length - 1].longitude, existing.samples[existing.samples.length - 1].latitude];
    } else {
      const { start, end } = this._stageAnchors(t, stage);
      s = await this._resolveAnchor(start);
      e = await this._resolveAnchor(end);
    }
    if (!s || !e) {
      alert(tr("Kein Etappenstart/-ziel bestimmbar."));
      this.renderDetail();
      this.renderMap();
      return;
    }
    const res = await this._routeStageThrough(t, [s, ...this._stageViaCoords(stage), e], this._stageLegDirect(stage));
    if (!res) {
      alert(tr("Routing fehlgeschlagen."));
      this.renderDetail();
      this.renderMap();
      return;
    }
    if (stage.plannedRouteRef && this.ridesStore) this.ridesStore.removeRides([stage.plannedRouteRef.rideId]);
    const ride = plannedRideFromCoords(res.coordinates, { title: stage.title, distanceMeters: res.distanceMeters, transportMode: t.transportMode || "cycling" });
    this.ridesStore.upsertRide(ride);
    stage.plannedRouteRef = { rideId: ride.id };
    this.store.touch();
    this.renderDetail();
    this.renderMap();
  }

  /** Removes search markers + result list. */
  _clearSearch() {
    this.searchMarkers.forEach((m) => m.remove());
    this.searchMarkers = [];
    this._clearSupply();
    const box = document.getElementById("nav-search-results");
    if (box) {
      box.innerHTML = "";
      box.classList.add("d-none");
    }
  }

  /** Remove supply markers. */
  _clearSupply() {
    this.supplyMarkers.forEach((m) => m.remove());
    this.supplyMarkers = [];
  }

  /**
   * Fetch supply (water/food/supermarket/bakery/pharmacy/bike shop …) along
   * the stage route via Overpass and show as emoji markers on the map.
   */
  async _showSupply(stage, btn) {
    const ride = stage.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(stage.plannedRouteRef.rideId) : null;
    if (!ride || !ride.samples || ride.samples.length < 2) return;
    const status = btn && btn.parentElement ? btn.parentElement.querySelector("[data-supply-status]") : null;
    this._clearSupply();
    if (status) status.textContent = tr("Suche …");
    if (btn) btn.disabled = true;
    const pois = await supplyAlongRoute(ride.samples);
    if (btn) btn.disabled = false;
    if (pois === null) {
      // All Overpass endpoints overloaded/unreachable.
      if (status) status.textContent = tr("Versorgungs-Dienst nicht erreichbar.");
      return;
    }
    for (const p of pois) {
      const el = document.createElement("div");
      el.className = "gc-supply-marker";
      el.textContent = p.icon;
      el.title = p.name || p.category;
      const m = new maplibregl.Marker({ element: el, subpixelPositioning: true }).setLngLat([p.lon, p.lat]).addTo(this.map);
      if (p.name) m.setPopup(new maplibregl.Popup({ offset: 12 }).setText(`${p.icon} ${p.name}`));
      this.supplyMarkers.push(m);
    }
    if (status) status.textContent = pois.length ? `${pois.length} ${tr("gefunden")}` : tr("Keine Treffer.");
  }

  /** Shows the last results as an overlay when focusing the (empty) search field. */
  _showRecentSearch() {
    const input = document.getElementById("nav-search");
    const box = document.getElementById("nav-search-results");
    if (!input || !box) return;
    if (input.value.trim()) return; // only with an empty field (don't disturb a real search)
    if (!this.lastResults?.length) return; // no earlier search yet
    // Pure re-display: without map markers, with a "Recently searched" header.
    this._renderSearchResults(this.lastResults, box, { withMarkers: false, recent: true });
  }

  /** Load the last search results from localStorage (survive a reload). */
  _loadRecentSearch() {
    try {
      const arr = JSON.parse(localStorage.getItem("gc.search.recent") || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  /** Save the last search results (max. 8) to localStorage. */
  _saveRecentSearch(results) {
    try {
      localStorage.setItem("gc.search.recent", JSON.stringify(results.slice(0, 8)));
    } catch {
      /* localStorage may be blocked/full → ignore */
    }
  }

  /**
   * Popup when tapping the map (without waypoint mode): "Search here" sets
   * the search center to the point; the POI quick targets search their
   * category directly around the point.
   */
  _showSearchPopup(lngLat, opts = {}) {
    const center = [lngLat.lng, lngLat.lat];
    const pois = loadPOIs().filter((p) => p.enabled !== false);
    const poiButtons = pois
      .map((p) => `<button class="btn btn-sm btn-outline-secondary py-0 px-1" data-poi="${esc(p.query)}">${esc(p.query)}</button>`)
      .join("");
    // If the displayed route was hit: offer a clear action at the top
    // (insert waypoint here or edit tour) — instead of inserting automatically.
    const editingTour = !!this.tourDraft;
    const shownTour = !this.trip && !editingTour && this.selectedTourId ? this.ridesStore?.getRide(this.selectedTourId) : null;
    let routeAction = "";
    if (opts.onRoute) {
      if (this.trip) {
        routeAction = `<button class="btn btn-sm btn-primary w-100 mb-2" data-insert-here>${tr("➕ Hier Wegpunkt einfügen")}</button>`;
      } else if (editingTour) {
        routeAction = `<button class="btn btn-sm btn-primary w-100 mb-2" data-tour-insert>${tr("➕ Hier Wegpunkt einfügen")}</button>`;
      } else if (shownTour) {
        routeAction = `<button class="btn btn-sm btn-primary w-100 mb-2" data-edit-tour>${tr("✏️ Tour bearbeiten")}</button>`;
      }
    }
    // Direct actions per context: open trip → start/destination/waypoint; tour in
    // edit mode → append waypoint; otherwise start a new tour here (a
    // new *trip* is deliberately created in the trips menu, not on the map).
    // Tour editor: no route yet (only start) → "Set as destination", otherwise append.
    const tourAppendLabel = editingTour && this.tourDraft.points.length < 2 ? tr("Als Ziel festlegen") : tr("Als Wegpunkt anhängen");
    // With an open trip, only planning-relevant actions: stage destination (when a stage
    // is selected), start accommodation, intermediate stop. Trip start/destination waypoints
    // are set in the waypoints section (auto-stages / without a template).
    const selStageC = this.trip && this._selectedStageId ? this.trip.stages.find((s) => s.id === this._selectedStageId) : null;
    const stageDestBtnC = selStageC ? `<button class="btn btn-sm btn-danger" data-wp-stage-dest>🏁 ${tr("Als Etappenziel")}</button>` : "";
    const tripActions = this.trip
      ? `<div class="d-grid gap-1 mb-2">
           ${stageDestBtnC}
           <button class="btn btn-sm btn-warning" data-wp-start-acc>🛏 ${tr("Als Start-Unterkunft")}</button>
           <button class="btn btn-sm btn-outline-primary" data-wp="stop">➕ ${tr("Als Zwischenstopp")}</button>
         </div>`
      : editingTour
        ? `<button class="btn btn-sm btn-primary w-100 mb-2" data-tour-append>${tourAppendLabel}</button>`
        : this.ridesStore
          ? `<div class="d-grid gap-1 mb-2">
               <button class="btn btn-sm btn-primary" data-set-dest>${tr("🎯 Als Ziel festlegen")}</button>
               <button class="btn btn-sm btn-outline-success" data-new-tour>${tr("+ Neue Tour (Start hier)")}</button>
             </div>`
          : "";
    // Header with point info: the coordinates immediately, the place name is loaded via
    // reverse geocoding (asynchronously, easy on the Nominatim limit).
    const html = `<div style="min-width:220px">
        <div class="mb-2">
          <div class="fw-semibold" data-pt-name>${tr("Ort wird ermittelt …")}</div>
          <div class="small text-secondary">${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}</div>
        </div>
        ${routeAction}
        ${tripActions}
        <button class="btn btn-sm btn-outline-primary w-100 mb-2" data-here>${tr("🔍 Hier suchen")}</button>
        ${poiButtons ? `<div class="small text-secondary mb-1">${tr("Schnellziele in der Nähe")}</div><div class="d-flex flex-wrap gap-1">${poiButtons}</div>` : ""}
      </div>`;
    const popup = new maplibregl.Popup({ offset: 12 }).setLngLat(lngLat).setHTML(html).addTo(this.map);
    const el = popup.getElement();
    reverseGeocode(lngLat.lat, lngLat.lng).then((name) => {
      const nameEl = popup.getElement()?.querySelector("[data-pt-name]");
      if (nameEl) nameEl.textContent = name || "Unbenannter Ort";
    });
    el?.querySelector("[data-insert-here]")?.addEventListener("click", () => {
      popup.remove();
      this._insertStopOnRoute(lngLat); // trip: insert a waypoint at the nearest segment
    });
    el?.querySelector("[data-edit-tour]")?.addEventListener("click", () => {
      popup.remove();
      if (shownTour) this._editTourOnMap(shownTour);
    });
    el?.querySelector("[data-tour-insert]")?.addEventListener("click", () => {
      popup.remove();
      this._insertTourPointOnRoute(lngLat); // tour editor: intermediate point at the nearest segment
    });
    el?.querySelector("[data-tour-append]")?.addEventListener("click", () => {
      popup.remove();
      this._addTourDraftPoint(lngLat); // tour editor: append a point (becomes the new destination)
    });
    el?.querySelector("[data-set-dest]")?.addEventListener("click", () => {
      popup.remove();
      this._setAsDestination(lngLat); // no start → location as start, this point as destination
    });
    el?.querySelectorAll("[data-wp]").forEach((b) =>
      b.addEventListener("click", () => {
        popup.remove();
        this._addWaypointAt(b.dataset.wp, lngLat);
      }),
    );
    // Click point → stage destination / start accommodation (adopt the name from the
    // reverse geocoding of the header if already resolved).
    const ptResult = () => {
      const nm = el?.querySelector("[data-pt-name]")?.textContent || "";
      const name = nm && nm !== tr("Ort wird ermittelt …") ? nm : "";
      return { lon: lngLat.lng, lat: lngLat.lat, name, displayName: name };
    };
    el?.querySelector("[data-wp-stage-dest]")?.addEventListener("click", () => {
      const r = ptResult();
      popup.remove();
      if (selStageC) this._setStageDestination(selStageC, r);
    });
    el?.querySelector("[data-wp-start-acc]")?.addEventListener("click", () => {
      const r = ptResult();
      popup.remove();
      const t = this.trip;
      if (!t) return;
      t.startAccommodation = Trips.makeAccommodation({ name: r.name, address: "", latitude: lngLat.lat, longitude: lngLat.lng });
      this.store.touch();
      this._clearSearch();
      this.renderDetail();
      this.renderMap();
      this.tripOffcanvas.show();
    });
    el?.querySelector("[data-new-tour]")?.addEventListener("click", () => {
      popup.remove();
      this._startTourDraft(lngLat); // tour-drawing mode with this start point
    });
    el?.querySelector("[data-here]")?.addEventListener("click", () => {
      popup.remove();
      this.searchCenter = center;
      const input = document.getElementById("nav-search");
      if (input && input.value.trim()) this.runSearch(input.value, center, { bounded: true });
      else input?.focus(); // enter a term → the next search uses this point (bounded)
    });
    el?.querySelectorAll("[data-poi]").forEach((b) =>
      b.addEventListener("click", () => {
        popup.remove();
        const input = document.getElementById("nav-search");
        if (input) input.value = b.dataset.poi; // make the search term visible
        // Limit POI quick targets strictly to the surroundings of the point.
        this.runSearch(b.dataset.poi, center, { bounded: true });
      }),
    );
  }

  /**
   * "Set as destination": if a tour is currently being edited, append the point
   * (new destination). Otherwise start a new tour — with the CURRENT position
   * (geolocation) as start and this point as destination.
   */
  _setAsDestination(lngLat) {
    if (this.tourDraft) {
      this._addTourDraftPoint(lngLat);
    } else {
      this._newTourWithGpsStart(lngLat);
    }
  }

  /** New tour: current location as start, `destLngLat` as destination → edit mode. */
  _newTourWithGpsStart(destLngLat) {
    if (!this.ridesStore) return;
    if (!navigator.geolocation) {
      alert(tr("Standortbestimmung wird vom Browser nicht unterstützt."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Location as start (creates the tour + opens it editable) …
        this._startTourDraft({ lng: pos.coords.longitude, lat: pos.coords.latitude });
        // … then append the chosen point as destination.
        this._addTourDraftPoint(destLngLat);
      },
      () => alert(tr("Standort konnte nicht ermittelt werden.")),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  /** Sets a tapped point as start/destination/intermediate stop of the current trip (with reverse geocoding). */
  _addWaypointAt(role, lngLat) {
    const t = this.trip;
    if (!t) return;
    const { lng, lat } = lngLat;
    const wp = Trips.makeWaypoint({ name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, latitude: lat, longitude: lng });
    if (role === "stop") {
      this._addStopForPlanning(wp); // into the selected stage if applicable
    } else {
      if (role === "start") t.startWaypoint = wp;
      else t.endWaypoint = wp;
      this.store.touch();
      this.renderDetail();
      this.renderMap();
      this.tripOffcanvas.show();
    }
    reverseGeocode(lat, lng).then((name) => {
      if (name && this.trip === t) {
        wp.name = name;
        this.store.touch();
        this.renderDetail();
        this.renderMap();
      }
    });
  }

  // --- Draw a tour directly on the map ---------------------------------------

  /**
   * Creates a new tour with the first point and opens it directly
   * editable on the map (like a trip). Further points are appended via
   * the info box, intermediate points via a click on the route.
   */
  _startTourDraft(lngLat) {
    if (!this.ridesStore) return;
    const ride = plannedRideFromCoords([[lngLat.lng, lngLat.lat]], {
      title: tr("Neue Tour"),
      distanceMeters: 0,
      transportMode: "cycling",
    });
    ride._extra = { planWaypoints: [{ lat: lngLat.lat, lng: lngLat.lng }] };
    this.ridesStore.upsertRide(ride);
    this.renderTours();
    this.tripOffcanvas.hide();
    this.selectTour(ride.id); // opens the tour directly in edit mode
  }

  /** Empty tour-drawing model with start points and an optional edit ID. */
  _makeTourDraft(points, editRideId) {
    return {
      points, // set support/waypoints [lng,lat] (first=start, last=destination)
      markers: [], // node markers (S … Z), draggable
      handles: [], // Komoot handles per route segment (drag → intermediate point)
      routedCoords: null, // last routed geometry [[lng,lat], …] (or null)
      routedDist: 0, // length of this route in meters
      routing: false, // is a routing request currently running?
      seq: 0, // sequence guard: only the most recent response counts
      editRideId, // set → edit an existing tour (instead of creating a new one)
      undoStack: [], // history of point states for undo
      savedPoints: this._clonePoints(points), // last SAVED state (transaction: no auto-save)
      original: null, // pre-edit snapshot (points + samples) for "restore original"
    };
  }

  /** Deep copy of a point list [[lng,lat], …]. */
  _clonePoints(pts) {
    return pts.map((p) => p.slice());
  }

  /** Compares two point lists for equality (incl. the direct flag p[2]). */
  _pointsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] || !!a[i][2] !== !!b[i][2]) return false;
    }
    return true;
  }

  /** Saves the current point state for undo (call before a change). */
  _pushTourUndo() {
    const d = this.tourDraft;
    if (!d) return;
    d.undoStack.push(this._clonePoints(d.points));
    if (d.undoStack.length > 100) d.undoStack.shift();
  }

  /** Edit a tour = select the tour (which opens it directly editable on the map). */
  _editTourOnMap(ride) {
    if (ride) this.selectTour(ride.id);
  }

  /**
   * Waypoints for editing a tour: prefer the persisted
   * planning waypoints (`_extra.planWaypoints`, from an earlier drawing);
   * otherwise thinned evenly from the samples to max. ~10 support points
   * (for GPX imports/round trips — the shape roughly follows the original).
   */
  _tourEditWaypoints(ride) {
    const wp = ride._extra?.planWaypoints;
    if (Array.isArray(wp) && wp.length >= 1) {
      return wp.filter((p) => p && p.lat != null && p.lng != null).map((p) => (p.direct ? [p.lng, p.lat, 1] : [p.lng, p.lat]));
    }
    const s = ride.samples || [];
    if (s.length < 2) return [];
    const n = Math.min(10, s.length);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.round((i * (s.length - 1)) / (n - 1));
      pts.push([s[idx].longitude, s[idx].latitude]);
    }
    return pts;
  }

  /** Appends another route point to the tour drawing on click. */
  _addTourDraftPoint(lngLat) {
    if (!this.tourDraft) return;
    this._pushTourUndo();
    this.tourDraft.points.push([lngLat.lng, lngLat.lat]);
    this._renderTourDraft();
  }

  /**
   * Draws the current tour drawing: numbered, draggable node
   * markers + the interactive drawing bar. The route line and the
   * insert handles are handled by `_routeTourDraft()` (live routed).
   */
  _renderTourDraft() {
    const d = this.tourDraft;
    if (!d) return;
    // Rebuild the node markers (first = "S", the rest numbered). Draggable →
    // move a point and re-route.
    d.markers.forEach((m) => m.remove());
    d.markers = d.points.map(([lng, lat], i) => {
      const el = document.createElement("div");
      el.className = "gc-tour-node";
      el.textContent = i === 0 ? "S" : i === d.points.length - 1 ? "Z" : String(i + 1);
      el.style.cursor = "grab";
      const marker = new maplibregl.Marker({ element: el, draggable: true, subpixelPositioning: true }).setLngLat([lng, lat]).addTo(this.map);
      let dragged = false;
      marker.on("dragstart", () => {
        dragged = true;
        this._pushTourUndo(); // save the state before moving for undo
      });
      marker.on("dragend", () => {
        dragged = false;
        const ll = marker.getLngLat();
        d.points[i] = [ll.lng, ll.lat, d.points[i][2]]; // keep the direct flag when moving
        this._renderTourDraft(); // moved → re-route
      });
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (dragged) return; // was a drag, not a click
        this._showMarkerInfo({ kind: "tourNode", lat, lng, index: i, count: d.points.length });
      });
      return marker;
    });
    this._refreshTourEditUI(); // waypoint list/stats/buttons immediately (preliminary)
    this._routeTourDraft(); // route live along the ways (asynchronously) → refresh again afterward
  }

  /**
   * Routes the set points live along the ways and draws the route
   * (plus the insert handles). First a straight-line preview appears
   * immediately, which is replaced by the road route once the provider's
   * response arrives. A sequence guard discards stale responses in the
   * meantime (fast further clicking/dragging).
   */
  async _routeTourDraft() {
    const d = this.tourDraft;
    if (!d) return;
    this._setTourDraftLine(d.points.map((p) => [p[0], p[1]])); // immediate straight-line preview
    if (d.points.length < 2) {
      d.routedCoords = null;
      d.routedDist = 0;
      this._renderTourInsertHandles();
      this._refreshTourEditUI();
      return;
    }
    // Plan the pieces: bundle consecutive routed legs into one provider
    // call, "direct" legs (p[2] truthy = override) as a straight line.
    const pts = d.points;
    const segments = [];
    let i = 1;
    while (i < pts.length) {
      if (pts[i][2]) {
        segments.push({ direct: true, a: pts[i - 1], b: pts[i] });
        i++;
      } else {
        let k = i;
        while (k + 1 < pts.length && !pts[k + 1][2]) k++;
        segments.push({ direct: false, pts: pts.slice(i - 1, k + 1) });
        i = k + 1;
      }
    }
    const seq = ++d.seq;
    d.routing = true;
    // Compute the routed pieces in parallel.
    const routed = await Promise.all(
      segments.map((s) =>
        s.direct
          ? Promise.resolve(null)
          : computeRoute(this.routingConfig, s.pts.map((p) => ({ longitude: p[0], latitude: p[1] }))).catch(() => null),
      ),
    );
    // Aborted or already clicked further → discard this (stale) response.
    if (this.tourDraft !== d || seq !== d.seq) return;
    // Assemble the geometry: solid (routed) + dashed
    // (direct) lines separately for display; `coords` = the full track.
    const coords = [[pts[0][0], pts[0][1]]];
    const solidLines = [];
    const directLines = [];
    segments.forEach((s, si) => {
      if (s.direct) {
        directLines.push([[s.a[0], s.a[1]], [s.b[0], s.b[1]]]); // straight line from the predecessor
        coords.push([s.b[0], s.b[1]]);
      } else {
        const r = routed[si];
        const c = r && r.coordinates && r.coordinates.length >= 2 ? r.coordinates : s.pts.map((p) => [p[0], p[1]]);
        solidLines.push(c);
        for (let j = 1; j < c.length; j++) coords.push(c[j]);
      }
    });
    d.routing = false;
    d.routedCoords = coords;
    d.routedDist = routeLength(coords);
    this._setTourDraftLines(solidLines, directLines);
    this._renderTourInsertHandles();
    this._refreshTourEditUI(); // update distances/stats now with the real route
  }

  /** Sets the solid (routed) + dashed (direct) tour lines. */
  _setTourDraftLines(solid, direct) {
    const mls = (lines) =>
      lines.length ? { type: "Feature", geometry: { type: "MultiLineString", coordinates: lines } } : { type: "FeatureCollection", features: [] };
    this.map.getSource("tour-draft")?.setData(mls(solid));
    this.map.getSource("tour-direct")?.setData(mls(direct));
  }

  /** Sets the preview line of the tour drawing (or clears it). */
  _setTourDraftLine(coords) {
    this.map.getSource("tour-draft")?.setData(
      coords && coords.length >= 2
        ? { type: "Feature", geometry: { type: "LineString", coordinates: coords } }
        : { type: "FeatureCollection", features: [] },
    );
    // Preview shows only the solid line; override dashes only after routing.
    this.map.getSource("tour-direct")?.setData({ type: "FeatureCollection", features: [] });
  }

  /**
   * Komoot-style: a white handle in the middle of each routed segment. Dragging
   * it creates a new intermediate point at that spot. The position of the user
   * points on the routed line is determined via `nearestIndex`.
   */
  _renderTourInsertHandles() {
    const d = this.tourDraft;
    if (!d) return;
    d.handles.forEach((m) => m.remove());
    d.handles = [];
    const coords = d.routedCoords;
    if (!coords || d.points.length < 2) return;
    const bounds = d.points.map((p) => nearestIndex(coords, p)); // index of each user point on the route
    for (let i = 0; i < bounds.length - 1; i++) {
      const mid = coords[Math.floor((bounds[i] + bounds[i + 1]) / 2)];
      if (!mid) continue;
      const el = document.createElement("div");
      el.className = "gc-insert-handle";
      el.title = tr("Ziehen, um hier einen Zwischenpunkt einzufügen");
      const handle = new maplibregl.Marker({ element: el, draggable: true, subpixelPositioning: true }).setLngLat(mid).addTo(this.map);
      const insertAt = i + 1; // new point between point i and i+1
      handle.on("dragend", () => this._insertTourPointAt(insertAt, handle.getLngLat()));
      d.handles.push(handle);
    }
  }

  /** Inserts a new support/intermediate point at position `index` of the tour points. */
  _insertTourPointAt(index, lngLat) {
    const d = this.tourDraft;
    if (!d) return;
    this._pushTourUndo();
    d.points.splice(index, 0, [lngLat.lng, lngLat.lat]);
    this._renderTourDraft();
  }

  /** Inserts an intermediate point at the nearest spot when clicking on the tour route. */
  _insertTourPointOnRoute(lngLat) {
    const d = this.tourDraft;
    if (!d || d.points.length < 2) return;
    const click = [lngLat.lng, lngLat.lat];
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < d.points.length - 1; i++) {
      const dd = this._distToSegment(click, d.points[i], d.points[i + 1]);
      if (dd < bestD) {
        bestD = dd;
        bestI = i;
      }
    }
    this._insertTourPointAt(bestI + 1, lngLat);
  }

  /** Removes a tour support point (at least 2 must remain) and re-routes. */
  _removeTourPoint(index) {
    const d = this.tourDraft;
    if (!d || d.points.length <= 2) return;
    this._pushTourUndo();
    d.points.splice(index, 1);
    this._renderTourDraft();
  }

  /** Moves a tour waypoint in the list by `delta` positions (−1 up, +1 down). */
  _moveTourPoint(index, delta) {
    const d = this.tourDraft;
    if (!d) return;
    const j = index + delta;
    if (j < 0 || j >= d.points.length) return;
    this._pushTourUndo();
    [d.points[index], d.points[j]] = [d.points[j], d.points[index]];
    this._renderTourDraft();
  }

  /**
   * Opens a tour directly for editing on the map (like a trip):
   * draggable nodes (S … Z) + live routed line + insert handles.
   * Points come from `_extra.planWaypoints` (otherwise derived from the samples).
   * Changes are NOT saved automatically — explicitly via "Save"
   * (`_saveTourDraft`); undo + "restore original" available.
   */
  _beginTourEdit(ride) {
    if (!ride) return;
    this._endTourEdit(); // clean up any previous tour editing
    this.selectedId = null; // no trip active
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    this._setTemplate([]);
    this._setRoute([]); // hide any trip route
    const wpts = this._tourEditWaypoints(ride);
    const d = this._makeTourDraft(wpts, ride.id);
    // Pre-edit snapshot for "restore original" (exact original track).
    d.original = {
      points: this._clonePoints(wpts),
      samples: ride.samples.slice(),
      totalDistanceMeters: ride.totalDistanceMeters,
      extra: { ...(ride._extra || {}) },
    };
    this.tourDraft = d;
    this._renderTourDraft();
    if (wpts.length) this._fitToCoords(wpts);
  }

  /**
   * Removes a currently edited, **empty** tour (0 km) on closing —
   * e.g. when setting a destination (immediately creates a "New tour") and then
   * discarding the changes again. A real (saved) route has > 0 km
   * and is kept.
   */
  _discardEmptyTourDraft() {
    const d = this.tourDraft;
    if (!d || !d.editRideId || !this.ridesStore) return;
    const ride = this.ridesStore.getRide(d.editRideId);
    if (ride && (ride.totalDistanceMeters || 0) <= 0) {
      this.ridesStore.removeRides([ride.id]);
      this.renderTours();
    }
  }

  /** Ends the tour editing and cleans up nodes, handles and the preview line. */
  _endTourEdit() {
    if (this.tourDraft) {
      this.tourDraft.markers.forEach((m) => m.remove());
      this.tourDraft.handles.forEach((m) => m.remove());
      this.tourDraft = null;
    }
    this.map.getSource("tour-draft")?.setData({ type: "FeatureCollection", features: [] });
    this.map.getSource("tour-direct")?.setData({ type: "FeatureCollection", features: [] });
  }

  /** True if the tour editing has unsaved changes. */
  _tourDirty() {
    const d = this.tourDraft;
    return !!d && !this._pointsEqual(d.points, d.savedPoints);
  }

  /**
   * Saves the current editing state explicitly into the tour: mutates the
   * existing ride object (name/notes in the panel are kept), writes geometry +
   * planning waypoints and resets the "saved" reference point.
   */
  _saveTourDraft() {
    const d = this.tourDraft;
    if (!d || !d.editRideId || !this._tourDirty()) return;
    const existing = this.ridesStore.getRide(d.editRideId);
    if (!existing) return;
    const coords = d.routedCoords && d.routedCoords.length >= 2 ? d.routedCoords : d.points;
    const dist = d.routedDist || routeLength(coords);
    const tmp = plannedRideFromCoords(coords, { distanceMeters: dist, transportMode: existing.transportMode || "cycling" });
    existing.samples = tmp.samples;
    existing.totalDistanceMeters = dist;
    existing._extra = {
      ...(existing._extra || {}),
      planWaypoints: d.points.map((p) => (p[2] ? { lat: p[1], lng: p[0], direct: true } : { lat: p[1], lng: p[0] })),
    };
    this.ridesStore.touch();
    d.savedPoints = this._clonePoints(d.points);
    this.renderTours();
    this._refreshTourEditUI();
  }

  /** Undoes the last point change. */
  _undoTourEdit() {
    const d = this.tourDraft;
    if (!d || !d.undoStack.length) return;
    d.points = d.undoStack.pop();
    this._renderTourDraft();
  }

  /**
   * Restores the original state of the tour (state when opened for
   * editing) — even after saving in the meantime. Resets the exact
   * original track (samples) and persists it.
   */
  _restoreTourOriginal() {
    const d = this.tourDraft;
    if (!d || !d.original) return;
    if (!confirm(tr("Tour auf den Originalstand zurücksetzen? Ungespeicherte und gespeicherte Änderungen dieser Sitzung gehen verloren."))) return;
    const existing = this.ridesStore.getRide(d.editRideId);
    if (existing) {
      existing.samples = d.original.samples.slice();
      existing.totalDistanceMeters = d.original.totalDistanceMeters;
      existing._extra = { ...d.original.extra };
      this.ridesStore.touch();
      this.renderTours();
    }
    // Re-initialize the editor from the (restored) original.
    if (existing) this._beginTourEdit(existing);
  }

  /** Updates stats + buttons + waypoint list of the open tour panel (without input fields). */
  _refreshTourEditUI() {
    if (!this.tourDraft) return;
    this._refreshTourStats();
    this._renderTourEditTools();
    this._renderTourWaypointList();
  }

  /** Route distance per waypoint: { legM (to predecessor), cumM (from start) }. */
  _tourLegDistances(d) {
    const coords = d.routedCoords && d.routedCoords.length >= 2 ? d.routedCoords : null;
    const bounds = coords ? d.points.map((p) => nearestIndex(coords, p)) : null;
    const out = [];
    let cum = 0;
    for (let i = 0; i < d.points.length; i++) {
      let legM = 0;
      if (i > 0) {
        if (coords) {
          const a = Math.min(bounds[i - 1], bounds[i]);
          const b = Math.max(bounds[i - 1], bounds[i]);
          legM = routeLength(coords.slice(a, b + 1));
        } else {
          legM = haversineMeters(d.points[i - 1], d.points[i]); // straight-line fallback
        }
      }
      cum += legM;
      out.push({ legM, cumM: cum });
    }
    return out;
  }

  /** Fills the edit buttons (save/undo/original) with the current state. */
  _renderTourEditTools() {
    const el = this.tourDetailEl?.querySelector("#tf-edittools");
    const d = this.tourDraft;
    if (!el || !d) return;
    const dirty = this._tourDirty();
    const changedFromOriginal = !d.original || !this._pointsEqual(d.points, d.original.points);
    el.innerHTML = `
      <button class="btn btn-sm btn-success flex-fill" data-tf-save ${dirty ? "" : "disabled"}>💾 ${tr("Speichern")}${dirty ? " *" : ""}</button>
      <button class="btn btn-sm btn-outline-secondary" data-tf-undo ${d.undoStack.length ? "" : "disabled"} title="${tr("Rückgängig")}">↶</button>
      <button class="btn btn-sm btn-outline-danger" data-tf-original ${changedFromOriginal ? "" : "disabled"} title="Originalstand wiederherstellen">↺ ${tr("Original")}</button>`;
    el.querySelector("[data-tf-save]")?.addEventListener("click", () => this._saveTourDraft());
    el.querySelector("[data-tf-undo]")?.addEventListener("click", () => this._undoTourEdit());
    el.querySelector("[data-tf-original]")?.addEventListener("click", () => this._restoreTourOriginal());
  }

  /** Fills the always-visible waypoint list (distance to predecessor + from start, sort/delete). */
  _renderTourWaypointList() {
    const el = this.tourDetailEl?.querySelector("#tf-waypoints");
    const d = this.tourDraft;
    if (!el || !d) return;
    if (!d.points.length) {
      el.innerHTML = `<div class="text-secondary small p-2">${tr("Noch keine Wegpunkte. Auf die Karte klicken zum Anhängen.")}</div>`;
      return;
    }
    const legs = this._tourLegDistances(d);
    const n = d.points.length;
    el.innerHTML = d.points
      .map((p, i) => {
        const label = i === 0 ? "S" : i === n - 1 ? "Z" : String(i + 1);
        const direct = !!p[2];
        const legKm = i === 0 ? "—" : `+${(legs[i].legM / 1000).toFixed(2)} km`;
        const legNote = i === 0 ? tr("ab Vorgänger") : direct ? tr("ab Vorgänger · Luftlinie (Override)") : tr("ab Vorgänger");
        const cum = `${(legs[i].cumM / 1000).toFixed(2)} km`;
        // Override button for the leg from the predecessor to this point (from i≥1).
        const directBtn =
          i === 0
            ? ""
            : `<button class="btn btn-sm py-0 px-1 ${direct ? "btn-warning" : "btn-outline-secondary"}" data-wpl-direct="${i}" title="${tr("Direkte Verbindung (Luftlinie) zum Vorgänger erzwingen – wenn das Routing den bekannten Weg nicht nimmt")}">📏</button>`;
        return `<div class="list-group-item d-flex align-items-center gap-2 py-1 px-2">
            <span class="badge text-bg-secondary">${label}</span>
            <div class="flex-grow-1 small">
              <div>${cum}</div>
              <div class="text-secondary">${legKm} ${legNote}</div>
            </div>
            ${this._jumpBtn(p[0], p[1])}
            ${directBtn}
            <button class="btn btn-sm btn-outline-secondary py-0 px-1" data-wpl-up="${i}" ${i === 0 ? "disabled" : ""} title="${tr("Nach oben")}">▲</button>
            <button class="btn btn-sm btn-outline-secondary py-0 px-1" data-wpl-down="${i}" ${i === n - 1 ? "disabled" : ""} title="${tr("Nach unten")}">▼</button>
            <button class="btn btn-sm btn-outline-danger py-0 px-1" data-wpl-del="${i}" ${n <= 2 ? "disabled" : ""} title="${tr("Entfernen")}">✕</button>
          </div>`;
      })
      .join("");
    this._wireJumpButtons(el);
    el.querySelectorAll("[data-wpl-direct]").forEach((b) =>
      b.addEventListener("click", () => this._toggleTourLegDirect(Number(b.dataset.wplDirect))),
    );
    el.querySelectorAll("[data-wpl-up]").forEach((b) =>
      b.addEventListener("click", () => this._moveTourPoint(Number(b.dataset.wplUp), -1)),
    );
    el.querySelectorAll("[data-wpl-down]").forEach((b) =>
      b.addEventListener("click", () => this._moveTourPoint(Number(b.dataset.wplDown), 1)),
    );
    el.querySelectorAll("[data-wpl-del]").forEach((b) =>
      b.addEventListener("click", () => {
        if (!confirm(tr("Wegpunkt entfernen?"))) return;
        this._removeTourPoint(Number(b.dataset.wplDel));
      }),
    );
  }

  /** Toggles the leg from the predecessor to point `index` between routed ⇄ direct (straight line). */
  _toggleTourLegDirect(index) {
    const d = this.tourDraft;
    if (!d || index < 1 || index >= d.points.length) return;
    this._pushTourUndo();
    const p = d.points[index];
    d.points[index] = p[2] ? [p[0], p[1]] : [p[0], p[1], 1];
    this._renderTourDraft();
  }

  // --- POI bar: categories in the current map view -------------------

  /** Builds the category chips above the map (from the maintained quick targets). */
  _renderPoiBar() {
    const bar = document.getElementById("poi-bar");
    if (!bar) return;
    const cats = loadPOIs().filter((p) => p.enabled !== false);
    if (!cats.length) {
      bar.innerHTML = "";
      return;
    }
    bar.innerHTML =
      `<span class="poi-bar-label">${tr("POIs hier:")}</span>` +
      cats.map((c) => `<button type="button" class="poi-chip" data-cat="${esc(poiLabel(c.query))}">${esc(poiLabel(c.query))}</button>`).join("") +
      `<button type="button" class="poi-chip poi-chip-clear" data-poi-clear title="${tr("Treffer ausblenden")}">✕</button>`;
    bar.querySelectorAll("[data-cat]").forEach((el) =>
      el.addEventListener("click", () => this._searchNearbyCategory(el.dataset.cat)),
    );
    bar.querySelector("[data-poi-clear]")?.addEventListener("click", () => {
      this._clearSearch();
      const input = document.getElementById("nav-search");
      if (input) input.value = "";
    });
  }

  /** Searches a POI category in the CURRENT map view → markers + results list. */
  async _searchNearbyCategory(query) {
    const c = this.map.getCenter();
    const b = this.map.getBounds();
    // Radius from the visible view (half the edge length), min. ~2 km.
    const radiusDeg = Math.max(Math.abs(b.getEast() - b.getWest()) / 2, Math.abs(b.getNorth() - b.getSouth()) / 2, 0.02);
    const box = document.getElementById("nav-search-results");
    const input = document.getElementById("nav-search");
    if (input) input.value = query;
    if (box) {
      box.classList.remove("d-none");
      box.innerHTML = `<div class="text-secondary small p-2">Suche „${esc(query)}" im Kartenausschnitt …</div>`;
    }
    const results = await searchNear(query, [c.lng, c.lat], 12, { bounded: true, radiusDeg });
    for (const r of results) r.distanceM = haversineMeters([c.lng, c.lat], [r.lon, r.lat]);
    results.sort((a, d) => a.distanceM - d.distanceM);
    this._renderSearchResults(results, box);
  }

  // --- Trip overview, quick actions, elevation profile, stop insert ----------

  /** Key figures of a trip: total distance + ascent (from stage routes), stages, days. */
  _tripSummary(t) {
    let distanceMeters = 0;
    let gainMeters = 0;
    if (this.ridesStore) {
      for (const s of t.stages) {
        const ride = s.plannedRouteRef ? this.ridesStore.getRide(s.plannedRouteRef.rideId) : null;
        if (ride) {
          distanceMeters += ride.totalDistanceMeters || 0;
          gainMeters += elevationGain(ride.samples);
        }
      }
    }
    let days = null;
    const end = Trips.plannedEndDate(t);
    if (t.plannedStartDate && end) {
      days = Math.round((new Date(end) - new Date(t.plannedStartDate)) / 86400000) + 1;
    }
    return { distanceMeters, gainMeters, stageCount: t.stages.length, days };
  }

  /** Sets the current device location as start (geolocation), loads the name afterwards. */
  _useMyLocationAsStart() {
    if (!navigator.geolocation) {
      alert(tr("Standortbestimmung wird vom Browser nicht unterstützt."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const t = this.trip;
        if (!t) return;
        const { latitude, longitude } = pos.coords;
        const wp = Trips.makeWaypoint({ name: "Mein Standort", latitude, longitude });
        t.startWaypoint = wp;
        this.store.touch();
        this.renderDetail();
        this.renderMap();
        this.map.flyTo({ center: [longitude, latitude], zoom: Math.max(this.map.getZoom(), 12) });
        reverseGeocode(latitude, longitude).then((name) => {
          if (name && this.trip === t) {
            wp.name = name;
            this.store.touch();
            this.renderDetail();
            this.renderMap();
          }
        });
      },
      () => alert(tr("Standort konnte nicht ermittelt werden.")),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  /** Reverses the route: swap start↔destination, mirror intermediate stops. */
  _reverseRoute() {
    const t = this.trip;
    if (!t) return;
    const oldStart = t.startWaypoint;
    t.startWaypoint = t.endWaypoint;
    t.endWaypoint = oldStart;
    t.intermediateStops.reverse();
    this.store.touch();
    this.renderDetail();
    this.renderMap();
  }

  /** Small elevation profile (inline SVG) of a stage route, or "" if practically flat. */
  _elevationProfileHtml(ride) {
    if (!ride || ride.samples.length < 2) return "";
    const alts = ride.samples.map((s) => s.altitude || 0);
    const minA = Math.min(...alts);
    const maxA = Math.max(...alts);
    if (maxA - minA < 5) return ""; // no usable elevation data
    const gain = Math.round(elevationGain(ride.samples));
    // cumulative distance as x-axis
    const xs = [0];
    for (let i = 1; i < ride.samples.length; i++) {
      const a = ride.samples[i - 1];
      const b = ride.samples[i];
      xs.push(xs[i - 1] + haversineMeters([a.longitude, a.latitude], [b.longitude, b.latitude]));
    }
    const total = xs[xs.length - 1] || 1;
    const W = 240;
    const H = 44;
    const pad = 2;
    const pts = ride.samples
      .map((s, i) => {
        const x = pad + (xs[i] / total) * (W - 2 * pad);
        const y = pad + (1 - ((s.altitude || 0) - minA) / (maxA - minA)) * (H - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return `<div class="mt-1">
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="background:#f1f5f5;border-radius:6px;display:block;">
        <polyline points="${pts}" fill="none" stroke="#0d9488" stroke-width="1.5"/>
      </svg>
      <div class="small text-secondary">↑ ${gain} m · ${minA.toFixed(0)}–${maxA.toFixed(0)} m</div>
    </div>`;
  }

  /** Inserts a new stop at position `index` of the intermediate stops (drag insert). */
  _insertStopAt(index, lngLat) {
    const t = this.trip;
    if (!t) return;
    const wp = Trips.makeWaypoint({
      name: `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`,
      latitude: lngLat.lat,
      longitude: lngLat.lng,
    });
    t.intermediateStops.splice(index, 0, wp);
    this.store.touch();
    this.renderDetail();
    this.renderMap();
    reverseGeocode(lngLat.lat, lngLat.lng).then((name) => {
      if (name && this.trip === t) {
        wp.name = name;
        this.store.touch();
        this.renderDetail();
        this.renderMap();
      }
    });
  }

  /** Checks whether a screen click point (±6 px) hit the displayed route (trip or tour editor). */
  _clickHitRoute(point) {
    const layers = ["trip-route", "tour-draft"].filter((id) => this.map.getLayer(id));
    if (!layers.length) return false;
    const pad = 6;
    const hits = this.map.queryRenderedFeatures(
      [
        [point.x - pad, point.y - pad],
        [point.x + pad, point.y + pad],
      ],
      { layers },
    );
    return hits.length > 0;
  }

  /**
   * Inserts an intermediate stop at the appropriate spot when clicking on the
   * route line: determines the nearest waypoint segment and thus the insert
   * index (number of stops to its left), then inserts at the click point.
   */
  _insertStopOnRoute(lngLat) {
    const t = this.trip;
    if (!t) return;
    const pts = this._orderedWaypoints(t);
    if (pts.length < 2) return;
    const click = [lngLat.lng, lngLat.lat];
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = this._distToSegment(click, [pts[i].longitude, pts[i].latitude], [pts[i + 1].longitude, pts[i + 1].latitude]);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    let insertIndex = 0;
    for (let k = 0; k <= bestI; k++) {
      if (pts[k] !== t.startWaypoint && pts[k] !== t.endWaypoint) insertIndex++;
    }
    this._insertStopAt(insertIndex, lngLat);
  }

  /** Distance of a point p to the segment a–b (planar in lng/lat, sufficient for segment picking). */
  _distToSegment(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let tt = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    tt = Math.max(0, Math.min(1, tt));
    const cx = a[0] + tt * dx;
    const cy = a[1] + tt * dy;
    return Math.hypot(p[0] - cx, p[1] - cy);
  }

  // --- GPX export/import ----------------------------------------------------

  /** Exports the stage routes of the current trip as a GPX file. */
  _exportGpx() {
    const t = this.trip;
    if (!t) return;
    const tracks = [];
    for (const s of t.stages) {
      const ride = s.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(s.plannedRouteRef.rideId) : null;
      if (ride && ride.samples.length) {
        tracks.push({ name: s.title || "Etappe", coords: ride.samples.map((sm) => [sm.longitude, sm.latitude, sm.altitude]) });
      }
    }
    if (!tracks.length) {
      alert(tr("Keine Etappen-Routen zum Exportieren vorhanden."));
      return;
    }
    const safeName = (t.title || "reise").replace(/[^\w.\-]+/g, "_");
    downloadText(`${safeName}.gpx`, buildGPX(tracks));
  }

  /** Imports a GPX file as a new trip (one stage with the route). */
  async _importGpx(file) {
    const { name, points } = parseGPX(await file.text());
    if (points.length < 2) {
      alert(tr("Keine Streckenpunkte in der GPX-Datei gefunden."));
      return;
    }
    const title = name || file.name.replace(/\.gpx$/i, "") || tr("Importierte Route");
    const ride = plannedRideFromCoords(points, {
      title,
      distanceMeters: routeLength(points),
      transportMode: "cycling",
    });
    this.ridesStore.upsertRide(ride);

    const first = points[0];
    const last = points[points.length - 1];
    const start = Trips.makeWaypoint({ name: `${first[1].toFixed(4)}, ${first[0].toFixed(4)}`, latitude: first[1], longitude: first[0] });
    const end = Trips.makeWaypoint({ name: `${last[1].toFixed(4)}, ${last[0].toFixed(4)}`, latitude: last[1], longitude: last[0] });

    const trip = this.store.createTrip(title);
    trip.startWaypoint = start;
    trip.endWaypoint = end;
    trip.stages = [Trips.makeStage({ title, plannedRouteRef: { rideId: ride.id } })];
    this.store.touch();
    this.select(trip.id);

    // Reverse-geocode the start/destination names afterwards.
    reverseGeocode(start.latitude, start.longitude).then((n) => {
      if (n) { start.name = n; this.store.touch(); if (this.trip === trip) this.renderDetail(); }
    });
    reverseGeocode(end.latitude, end.longitude).then((n) => {
      if (n) { end.name = n; this.store.touch(); if (this.trip === trip) this.renderDetail(); }
    });
  }

  // --- Auto stages ---------------------------------------------------------

  /** Reads the modal inputs and triggers the auto-stage generation. */
  async _runAutoplan() {
    const statusEl = document.getElementById("ap-status");
    const mode = document.querySelector('input[name="ap-mode"]:checked')?.value || "distance";
    const value =
      mode === "count"
        ? parseInt(document.getElementById("ap-count").value, 10)
        : parseFloat(document.getElementById("ap-distance").value);
    statusEl.textContent = tr("Route wird berechnet …");
    const res = await this.autoplan({ mode, value });
    statusEl.textContent = res.msg;
    if (res.ok) setTimeout(() => this.autoplanModal.hide(), 900);
  }

  /**
   * Routes start → (stops) → destination, splits the route by distance/count,
   * creates split points as intermediate stops and one stage per segment. The
   * split-point names are then geocoded afterwards (gently, sequentially).
   */
  async autoplan({ mode, value }) {
    const t = this.trip;
    if (!t) return { ok: false, msg: tr("Keine Reise gewählt.") };

    // With template: split its geometry (trimmed to start/destination).
    // Without template: route freely between start → stops → destination.
    let coords;
    const template = this._templateCoords(t);
    if (template.length >= 2) {
      coords = this._trimTemplate(template, t);
    } else {
      if (!t.startWaypoint || !t.endWaypoint) return { ok: false, msg: tr("Start und Ziel (oder eine Vorlage) nötig.") };
      const r = await computeRoute(this.routingConfig, [t.startWaypoint, ...t.intermediateStops, t.endWaypoint]);
      if (!r || !r.coordinates || r.coordinates.length < 2) return { ok: false, msg: tr("Routing fehlgeschlagen.") };
      coords = r.coordinates;
    }

    const target = mode === "count" ? routeLength(coords) / Math.max(1, value | 0) : Math.max(1, value) * 1000;
    const { points } = splitRoute(coords, target); // ideal (geometric) split points

    // Snap each split point to a nearby Snap-POI (stage destination: hotel/station …)
    // so that the stages orient themselves to the Snap-POIs. No POI in
    // range → geometric point as fallback.
    const cats = loadPOIs("snap").filter((c) => c.enabled !== false);
    const snapMax = Math.min(40000, Math.max(3000, target * 0.4)); // max. deviation from the split point
    const snapped = [];
    for (const p of points) {
      const poi = cats.length ? await this._nearestSnapPoi(cats, p, snapMax) : null;
      snapped.push(poi || { coord: p, name: "", osmCategory: null, osmType: null });
    }

    // Remove old stage routes of this trip before new ones are created.
    if (this.ridesStore) {
      this.ridesStore.removeRides(t.stages.map((s) => s.plannedRouteRef?.rideId).filter(Boolean));
    }

    // Boundary waypoints (marker + name source).
    const boundaryWps = snapped.map((s) =>
      Trips.makeWaypoint({ name: s.name || `${s.coord[1].toFixed(4)}, ${s.coord[0].toFixed(4)}`, latitude: s.coord[1], longitude: s.coord[0] }),
    );
    t.intermediateStops = boundaryWps;

    const startC = coords[0];
    const endC = coords[coords.length - 1];
    const startName = (t.startWaypoint && t.startWaypoint.name) || tr("Start");
    const ends = [...snapped.map((s) => ({ coord: s.coord, poi: s })), { coord: endC, poi: null }];

    // Stages: prev → Snap-POI/destination, each template-faithful with deviation to the POI.
    let prev = startC;
    let prevName = startName;
    const newStages = [];
    for (let i = 0; i < ends.length; i++) {
      const { coord: destC, poi } = ends[i];
      const destName = poi ? poi.name : (t.endWaypoint && t.endWaypoint.name) || "";
      const title = `${prevName} – ${destName || tr("Ziel")}`;
      const stage = Trips.makeStage({ title });
      const res = await this._routeBetween(t, prev, destC);
      if (this.ridesStore && res && res.coordinates.length >= 2) {
        const ride = plannedRideFromCoords(res.coordinates, { title, distanceMeters: res.distanceMeters, transportMode: t.transportMode || "cycling" });
        this.ridesStore.upsertRide(ride);
        stage.plannedRouteRef = { rideId: ride.id };
      }
      // If the stage ends at an accommodation → set it directly as the stage accommodation.
      if (poi && this._isAccommodationCandidate(poi)) {
        stage.accommodation = Trips.makeAccommodation({ name: poi.name || "", latitude: poi.coord[1], longitude: poi.coord[0] });
      }
      newStages.push(stage);
      prev = destC;
      prevName = destName || prevName;
    }
    t.stages = newStages;
    this.store.touch();
    this.renderDetail();
    this.renderMap();

    // Provide names for the geometric fallback boundaries afterwards (Snap-POIs already have them).
    for (let i = 0; i < snapped.length; i++) {
      if (!snapped[i].name) {
        const nm = await reverseGeocode(boundaryWps[i].latitude, boundaryWps[i].longitude);
        if (nm) boundaryWps[i].name = nm;
      }
    }
    if (this.trip === t) {
      const seqNames = [startName, ...boundaryWps.map((w) => w.name), (t.endWaypoint && t.endWaypoint.name) || ""];
      t.stages.forEach((s, i) => {
        s.title = `${seqNames[i] || ""} – ${seqNames[i + 1] || tr("Ziel")}`;
        if (s.plannedRouteRef && this.ridesStore) {
          const ride = this.ridesStore.getRide(s.plannedRouteRef.rideId);
          if (ride) {
            ride.title = s.title;
            this.ridesStore.touch();
          }
        }
      });
      this.store.touch();
      this.renderDetail();
    }
    return { ok: true, msg: tr("{n} Etappen erzeugt.").replace("{n}", t.stages.length) };
  }

  /**
   * Searches the active Snap-POI (stage destination) closest to the point within
   * `maxMeters`. Returns { coord, name, osmCategory, osmType } or null.
   */
  async _nearestSnapPoi(cats, point, maxMeters) {
    const radiusDeg = Math.min(0.5, maxMeters / 111000 + 0.02);
    const batches = await Promise.all(cats.map((c) => searchNear(poiLabel(c.query), point, 5, { bounded: true, radiusDeg })));
    let best = null;
    let bestD = Infinity;
    for (const arr of batches) {
      for (const r of arr) {
        const d = haversineMeters(point, [r.lon, r.lat]);
        if (d <= maxMeters && d < bestD) {
          bestD = d;
          best = { coord: [r.lon, r.lat], name: r.name, osmCategory: r.osmCategory, osmType: r.osmType };
        }
      }
    }
    return best;
  }

  _ensureRouteLayer() {
    // Before the style load addSource would throw → create only afterwards. The
    // _setRoute* callers then check for an existing source.
    if (!this.map.isStyleLoaded() || this.map.getSource("trip-route")) return;
    // Template first (red, lies BELOW the blue stage routes).
    this.map.addSource("trip-template", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    this.map.addLayer({
      id: "trip-template",
      type: "line",
      source: "trip-template",
      paint: { "line-color": "#dc3545", "line-width": 4, "line-opacity": 0.85 },
    });
    this.map.addSource("trip-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    this.map.addLayer({
      id: "trip-route",
      type: "line",
      source: "trip-route",
      paint: { "line-color": "#0d6efd", "line-width": 4, "line-opacity": 0.8 },
    });
    // Tour editing route: blue + solid (like the trip route).
    this.map.addSource("tour-draft", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    this.map.addLayer({
      id: "tour-draft",
      type: "line",
      source: "tour-draft",
      paint: { "line-color": "#0d6efd", "line-width": 4, "line-opacity": 0.85 },
    });
    // Direct (override) sub-sections: dashed, slightly offset color.
    this.map.addSource("tour-direct", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    this.map.addLayer({
      id: "tour-direct",
      type: "line",
      source: "tour-direct",
      paint: { "line-color": "#e8590c", "line-width": 4, "line-dasharray": [1.5, 1.5], "line-opacity": 0.95 },
    });
    // Single highlighted stage route ("show route"): strong purple,
    // thicker and on top → stands out from the blue stage routes.
    this.map.addSource("stage-highlight", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    this.map.addLayer({
      id: "stage-highlight",
      type: "line",
      source: "stage-highlight",
      paint: { "line-color": "#7c3aed", "line-width": 7, "line-opacity": 0.95 },
    });
    // Selected section piece (leg) — yellow, on top.
    this.map.addSource("leg-highlight", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    this.map.addLayer({
      id: "leg-highlight",
      type: "line",
      source: "leg-highlight",
      paint: { "line-color": "#ffc107", "line-width": 8, "line-opacity": 0.95 },
    });
  }

  /** Sets the highlighted stage line (or clears it). */
  _setStageHighlight(coordinates) {
    this._ensureRouteLayer();
    const src = this.map.getSource("stage-highlight");
    if (!src) return;
    src.setData(
      coordinates.length
        ? { type: "Feature", geometry: { type: "LineString", coordinates } }
        : { type: "FeatureCollection", features: [] },
    );
  }

  /** Sets the yellow-highlighted section piece (or clears it). */
  _setLegHighlight(coordinates) {
    this._ensureRouteLayer();
    const src = this.map.getSource("leg-highlight");
    if (!src) return;
    src.setData(
      coordinates && coordinates.length
        ? { type: "Feature", geometry: { type: "LineString", coordinates } }
        : { type: "FeatureCollection", features: [] },
    );
  }

  /**
   * Highlights the route of ONE stage on the map and zooms to it. Remembers
   * the stage (`_highlightStageId`) so that `renderMap` keeps the highlight
   * across redraws; switching the trip clears it automatically
   * (stage ID no longer present).
   */
  _showStageRoute(stage) {
    const ride = stage.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(stage.plannedRouteRef.rideId) : null;
    if (!ride || ride.samples.length < 2) {
      alert(tr("Diese Etappe hat noch keine berechnete Route."));
      return;
    }
    const coords = ride.samples.map((sm) => [sm.longitude, sm.latitude]);
    this._highlightStageId = stage.id;
    this._setStageHighlight(coords);
    this._fitToCoords(coords);
  }

  /**
   * Selects a stage: highlights its route (purple, without moving the
   * map), marks its map marker and highlights the stage in the side menu
   * (the card scrolls into view). Deliberately WITHOUT renderMap, because its
   * automatic flyTo would otherwise move the view back to the trip start.
   */
  _selectStage(stage) {
    this._selectedStageId = stage.id;
    this._highlightStageId = stage.id;
    this._selectedLeg = null; // stage switch → reset section selection
    const ride = stage.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(stage.plannedRouteRef.rideId) : null;
    if (ride && ride.samples.length >= 2) this._setStageHighlight(ride.samples.map((sm) => [sm.longitude, sm.latitude]));
    // Redraw the map (stage/section markers), but WITHOUT re-centering.
    this.renderMap();
    // Side menu: highlight the stage card + scroll it into view.
    this.renderDetail();
    this.detailEl?.querySelector(`[data-stage="${stage.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /** Sets the red template line (or clears it). */
  _setTemplate(coordinates) {
    this._ensureRouteLayer();
    const src = this.map.getSource("trip-template");
    if (!src) return;
    src.setData(
      coordinates.length
        ? { type: "Feature", geometry: { type: "LineString", coordinates } }
        : { type: "FeatureCollection", features: [] },
    );
  }

  /** Geometry of the assigned template as [lng,lat][] or [] (none/empty). */
  _templateCoords(trip) {
    const ride = trip && trip.assignedRouteId && this.ridesStore ? this.ridesStore.getRide(trip.assignedRouteId) : null;
    return ride && ride.samples.length >= 2 ? ride.samples.map((sm) => [sm.longitude, sm.latitude]) : [];
  }

  /**
   * Projects `coord` onto the template line `tmpl` and returns both: the shortest
   * straight line to the line (`perp`, perpendicular deviation) AND the arc length
   * from the template start to the projection (`arc`, position ALONG the
   * template). `tt` is the parametric fraction within the (short) segment ≈ the
   * fraction in meters — accurate enough for a densely sampled template.
   */
  _projectOnTemplate(tmpl, coord) {
    let perp = Infinity;
    let arc = 0;
    let acc = 0;
    for (let i = 0; i < tmpl.length - 1; i++) {
      const a = tmpl[i];
      const b = tmpl[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      let tt = len2 ? ((coord[0] - a[0]) * dx + (coord[1] - a[1]) * dy) / len2 : 0;
      tt = Math.max(0, Math.min(1, tt));
      const proj = [a[0] + tt * dx, a[1] + tt * dy];
      const d = haversineMeters(coord, proj);
      const segLen = haversineMeters(a, b);
      if (d < perp) {
        perp = d;
        arc = acc + segLen * tt; // arc length up to the projection
      }
      acc += segLen;
    }
    return { perp, arc };
  }

  /**
   * Shortest distance (meters) from `coord` to the assigned template line, or
   * null if no template is set. Deviation measure for "Next stage": how far a
   * destination lies PERPENDICULARLY from the planned route.
   */
  _distanceToTemplateMeters(t, coord) {
    const tmpl = this._templateCoords(t);
    if (tmpl.length < 2) return null;
    return this._projectOnTemplate(tmpl, coord).perp;
  }

  /**
   * Distance ALONG the assigned template (meters) between the projections of
   * `fromCoord` and `toCoord` onto the template line, or null without a template.
   * That is the actually ridden distance — NOT the straight line: e.g.
   * Schweinfurt→Würzburg along the Main cycle path ~95 km instead of ~36 km
   * straight line.
   */
  _alongTemplateMeters(t, fromCoord, toCoord) {
    const tmpl = this._templateCoords(t);
    if (tmpl.length < 2) return null;
    const sFrom = this._projectOnTemplate(tmpl, fromCoord).arc;
    const sTo = this._projectOnTemplate(tmpl, toCoord).arc;
    return Math.abs(sTo - sFrom);
  }

  /**
   * Point on the template that lies ~`dist` meters ALONG the template from the
   * cursor (projected onto the template) — i.e. ahead in travel direction.
   * Returns null if no template is set; for a too-short template the
   * endpoint. Example: cur at the template start, dist 60 km → point 60 km further
   * on the template line. Basis of the "corridor" mode of "next stage".
   */
  _templateAheadPoint(t, curCoord, dist) {
    const tmpl = this._templateCoords(t);
    if (tmpl.length < 2) return null;
    let i = nearestIndex(tmpl, curCoord);
    let acc = 0;
    for (; i < tmpl.length - 1; i++) {
      const seg = haversineMeters(tmpl[i], tmpl[i + 1]);
      if (acc + seg >= dist) {
        const frac = seg > 0 ? (dist - acc) / seg : 0;
        return [tmpl[i][0] + (tmpl[i + 1][0] - tmpl[i][0]) * frac, tmpl[i][1] + (tmpl[i + 1][1] - tmpl[i][1]) * frac];
      }
      acc += seg;
    }
    return tmpl[tmpl.length - 1];
  }

  /** Trims the template geometry to the range start…destination (if set). */
  _trimTemplate(coords, t) {
    let lo = 0;
    let hi = coords.length - 1;
    if (t.startWaypoint) lo = nearestIndex(coords, [t.startWaypoint.longitude, t.startWaypoint.latitude]);
    if (t.endWaypoint) hi = nearestIndex(coords, [t.endWaypoint.longitude, t.endWaypoint.latitude]);
    if (lo > hi) [lo, hi] = [hi, lo];
    return coords.slice(lo, hi + 1);
  }

  /** Waypoints of the selected trip in order start → stops → destination. */
  _orderedWaypoints(t) {
    const pts = [];
    if (t.startWaypoint) pts.push(t.startWaypoint);
    pts.push(...t.intermediateStops);
    if (t.endWaypoint) pts.push(t.endWaypoint);
    return pts;
  }

  /** Moves an intermediate stop by `delta` positions (−1 up, +1 down). */
  _moveStop(t, id, delta) {
    const i = t.intermediateStops.findIndex((s) => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= t.intermediateStops.length) return;
    const arr = t.intermediateStops;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.store.touch();
    this.renderDetail();
  }

  // --- Marker info modal (click on start/destination/waypoint/accommodation) ---------

  /**
   * Makes a marker interactive: click opens the info modal, dragging
   * moves it (onDragEnd receives the new position). The click after a
   * drag is suppressed so that the modal does not open accidentally.
   */
  _wireMarker(marker, { title, onClick, onDragEnd }) {
    const el = marker.getElement();
    el.style.cursor = onDragEnd ? "grab" : "pointer";
    if (title) el.title = title; // native tooltip on hover
    let dragged = false;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (dragged) {
        dragged = false;
        return;
      }
      onClick();
    });
    if (onDragEnd) {
      marker.on("dragstart", () => {
        dragged = true;
      });
      marker.on("dragend", () => onDragEnd(marker.getLngLat()));
    }
  }

  /** Waypoint was moved on the map → take over the coordinate, re-route, load the name afterwards. */
  _onWaypointDragged(t, wp, lngLat) {
    wp.latitude = lngLat.lat;
    wp.longitude = lngLat.lng;
    this.store.touch();
    this.renderDetail();
    this.renderMap();
    reverseGeocode(lngLat.lat, lngLat.lng).then((name) => {
      if (name && this.trip === t) {
        wp.name = name;
        this.store.touch();
        this.renderDetail();
        this.renderMap();
      }
    });
  }

  /** Accommodation was moved → take over the coordinate, load the address afterwards (if empty). */
  _onAccommodationDragged(t, acc, lngLat) {
    acc.latitude = lngLat.lat;
    acc.longitude = lngLat.lng;
    this.store.touch();
    this.renderDetail();
    this.renderMap();
    reverseGeocode(lngLat.lat, lngLat.lng).then((name) => {
      if (name && this.trip === t && !acc.address) {
        acc.address = name;
        this.store.touch();
        this.renderDetail();
      }
    });
  }

  /** OpenStreetMap link to a coordinate (opens in a new tab). */
  _osmUrl(lat, lon) {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
  }

  /** Shows the marker detail as an info box (popup) directly at the marker (waypoint/accommodation/place). */
  _showMarkerInfo(info) {
    const t = this.trip;
    // Anchor coordinate depending on the marker type.
    let lat;
    let lon;
    if (info.kind === "place") {
      lat = info.result.lat;
      lon = info.result.lon;
    } else if (info.kind === "tourNode") {
      lat = info.lat;
      lon = info.lng;
    } else if (info.kind === "waypoint") {
      lat = info.wp.latitude;
      lon = info.wp.longitude;
    } else if (info.kind === "stage" || info.kind === "leg") {
      lat = info.lat;
      lon = info.lng;
    } else {
      lat = info.acc.latitude;
      lon = info.acc.longitude;
    }
    if (lat == null || lon == null) return;
    // Only ever ONE info window: close a previously opened one.
    if (this._infoPopup) this._infoPopup.remove();
    const popup = new maplibregl.Popup({ offset: 18, maxWidth: "300px" })
      .setLngLat([lon, lat])
      .setHTML(`<div style="min-width:220px">
          <div class="fw-semibold mb-2" data-mi-title></div>
          <div data-mi-body></div>
          <div class="d-flex flex-wrap gap-1 mt-2" data-mi-footer></div>
        </div>`)
      .addTo(this.map);
    this._infoPopup = popup;
    popup.on("close", () => {
      if (this._infoPopup === popup) this._infoPopup = null;
    });
    const root = popup.getElement();
    const titleEl = root.querySelector("[data-mi-title]");
    const body = root.querySelector("[data-mi-body]");
    const footer = root.querySelector("[data-mi-footer]");
    const close = () => popup.remove();

    // Marked place (search result/POI) — also works without an open trip.
    if (info.kind === "place") {
      this._fillPlaceInfo(info.result, titleEl, body, footer, close);
      return;
    }
    // Tour node (in the tour editor) — moving via drag, here only info + remove.
    if (info.kind === "tourNode") {
      const { index, count } = info;
      const roleLabel = index === 0 ? tr("Start") : index === count - 1 ? tr("Ziel") : `${tr("Zwischenpunkt")} ${index}`;
      titleEl.textContent = roleLabel;
      body.innerHTML = `<div class="mb-2"><span class="badge text-bg-secondary">Tour-Wegpunkt</span></div>
        <div class="small text-secondary">${tr("Koordinaten")}</div><div>${lat.toFixed(5)}, ${lon.toFixed(5)}</div>`;
      footer.innerHTML = `
        <a class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener" href="${this._osmUrl(lat, lon)}">${tr("In Karten öffnen")}</a>
        <button class="btn btn-sm btn-outline-danger" data-tn-remove ${count <= 2 ? "disabled" : ""}>${tr("Entfernen")}</button>`;
      footer.querySelector("[data-tn-remove]")?.addEventListener("click", () => {
        if (!confirm(tr("Wegpunkt entfernen?"))) return;
        this._removeTourPoint(index);
        close();
      });
      return;
    }
    if (!t) {
      close();
      return; // waypoint/accommodation/stage need an open trip
    }

    // Section marker: follow the template for this leg OR route directly.
    if (info.kind === "leg") {
      const { stage, legIndex, destName } = info;
      const direct = this._stageLegDirect(stage)[legIndex];
      titleEl.textContent = `${tr("Abschnitt")} → ${destName || tr("Ziel")}`;
      body.innerHTML = `<div class="small text-secondary">${tr("Wie soll dieser Abschnitt geführt werden?")}</div>`;
      footer.innerHTML = `
        <button class="btn btn-sm ${!direct ? "btn-primary" : "btn-outline-secondary"}" data-mi-leg-template>🧭 ${tr("Vorlage folgen")}</button>
        <button class="btn btn-sm ${direct ? "btn-warning" : "btn-outline-secondary"}" data-mi-leg-direct>📏 ${tr("Direkt")}</button>`;
      const setMode = (wantDirect) => {
        if (this._stageLegDirect(stage)[legIndex] !== wantDirect) {
          this._toggleStageLeg(stage, legIndex);
          this.store.touch();
          this._recomputeStageWithVias(t, stage);
        }
        close();
      };
      footer.querySelector("[data-mi-leg-template]")?.addEventListener("click", () => setMode(false));
      footer.querySelector("[data-mi-leg-direct]")?.addEventListener("click", () => setMode(true));
      return;
    }

    // Stage marker: short info dialog (distance/status/nights/accommodation) +
    // actions "show route" and "open in menu".
    if (info.kind === "stage") {
      const { stage, num } = info;
      const ride = stage.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(stage.plannedRouteRef.rideId) : null;
      const km = ride ? `${(ride.totalDistanceMeters / 1000).toFixed(1)} km` : "–";
      const statusLabel = { planned: tr("Geplant"), active: tr("Aktiv"), completed: tr("Abgeschlossen") }[stage.status] || tr("Geplant");
      const accLine = stage.accommodation && stage.accommodation.name ? `<div class="small mt-1">🛏 ${esc(stage.accommodation.name)}</div>` : "";
      titleEl.textContent = `${tr("Etappe")} ${num}${stage.title ? " · " + stage.title : ""}`;
      body.innerHTML = `<div class="d-flex flex-wrap gap-1">
          <span class="badge text-bg-primary">${km}</span>
          <span class="badge text-bg-secondary">${esc(statusLabel)}</span>
          <span class="badge text-bg-light text-dark">🌙 ${stage.overnightStays || 1}</span>
        </div>${accLine}`;
      footer.innerHTML = `
        <button class="btn btn-sm btn-outline-primary" data-mi-stage-show ${ride ? "" : "disabled"}>${tr("Route anzeigen")}</button>
        <button class="btn btn-sm btn-outline-secondary" data-mi-stage-edit>${tr("Im Menü öffnen")}</button>`;
      footer.querySelector("[data-mi-stage-show]")?.addEventListener("click", () => {
        this._showStageRoute(stage);
        close();
      });
      footer.querySelector("[data-mi-stage-edit]")?.addEventListener("click", () => {
        this.tripOffcanvas.show();
        this.detailEl?.querySelector(`[data-stage="${stage.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        close();
      });
      return;
    }

    if (info.kind === "waypoint") {
      const { wp, role, index, stopCount } = info;
      const roleLabel = role === "start" ? tr("Start") : role === "end" ? tr("Ziel") : tr("Zwischenziel {n} von {total}").replace("{n}", index + 1).replace("{total}", stopCount);
      const roleColor = role === "start" ? "text-bg-success" : role === "end" ? "text-bg-danger" : "text-bg-primary";
      titleEl.textContent = wp.name || roleLabel;
      body.innerHTML = `
        <div class="mb-2"><span class="badge ${roleColor}">${esc(roleLabel)}</span></div>
        <label class="form-label small mb-1">Name</label>
        <input class="form-control form-control-sm mb-3" data-mi-name value="${esc(wp.name || "")}" placeholder="Name" autocomplete="off">
        <div class="small text-secondary">${tr("Koordinaten")}</div>
        <div>${lat.toFixed(5)}, ${lon.toFixed(5)}</div>`;
      body.querySelector("[data-mi-name]")?.addEventListener("input", (e) => {
        wp.name = e.target.value;
        titleEl.textContent = e.target.value || roleLabel;
        this.store.touch();
        this.renderDetail();
      });
      footer.innerHTML = `
        <a class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener" href="${this._osmUrl(lat, lon)}">${tr("In Karten öffnen")}</a>
        <button class="btn btn-sm btn-outline-secondary gc-jump" data-mi-center title="${tr("Auf der Karte zeigen")}">${CROSSHAIR_ICON}</button>
        ${role === "stop" ? `<button class="btn btn-sm btn-outline-secondary" data-mi-up ${index === 0 ? "disabled" : ""} title="${tr("Nach oben")}">▲</button>
          <button class="btn btn-sm btn-outline-secondary" data-mi-down ${index === stopCount - 1 ? "disabled" : ""} title="${tr("Nach unten")}">▼</button>` : ""}
        <button class="btn btn-sm btn-outline-danger" data-mi-remove>${tr("Entfernen")}</button>`;
      footer.querySelector("[data-mi-remove]")?.addEventListener("click", () => {
        if (!confirm(tr("Diesen Wegpunkt entfernen?"))) return;
        this._removeWaypoint(role, wp.id);
        close();
      });
      footer.querySelector("[data-mi-up]")?.addEventListener("click", () => {
        this._moveStop(t, wp.id, -1);
        close();
      });
      footer.querySelector("[data-mi-down]")?.addEventListener("click", () => {
        this._moveStop(t, wp.id, 1);
        close();
      });
    } else {
      const { acc, label, scope } = info;
      titleEl.textContent = `🛏 ${acc.name || label}`;
      const typeLabel = scope.type === "start" ? tr("Start-Unterkunft") : tr("Unterkunft · {label}").replace("{label}", label);
      const rows = [
        acc.address ? `<div class="small text-secondary">${tr("Adresse")}</div><div class="mb-2">${esc(acc.address)}</div>` : "",
        acc.price != null
          ? `<div class="small text-secondary">${tr("Preis")}</div><div class="mb-2">${money(acc.price)}${acc.isBooked ? " · " + tr("gebucht") : ""}</div>`
          : acc.isBooked
            ? `<div class="mb-2">${tr("gebucht")}</div>`
            : "",
        acc.checkInTime ? `<div class="small text-secondary">Check-in</div><div class="mb-2">${timeToInput(acc.checkInTime)}</div>` : "",
        `<div class="small text-secondary">${tr("Koordinaten")}</div><div>${lat.toFixed(5)}, ${lon.toFixed(5)}</div>`,
      ].join("");
      body.innerHTML = `<div class="mb-2"><span class="badge text-bg-warning">${esc(typeLabel)}</span></div>
        <label class="form-label small mb-1">Name</label>
        <input class="form-control form-control-sm mb-3" data-mi-name value="${esc(acc.name || "")}" placeholder="${tr("Unterkunft (Name)")}" autocomplete="off">
        ${rows}`;
      body.querySelector("[data-mi-name]")?.addEventListener("input", (e) => {
        acc.name = e.target.value;
        titleEl.textContent = `🛏 ${e.target.value || label}`;
        this.store.touch();
        this.renderDetail();
      });
      footer.innerHTML = `
        <a class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener" href="${this._osmUrl(lat, lon)}">${tr("In Karten öffnen")}</a>
        <button class="btn btn-sm btn-outline-secondary gc-jump" data-mi-center title="${tr("Auf der Karte zeigen")}">${CROSSHAIR_ICON}</button>
        <button class="btn btn-sm btn-outline-danger" data-mi-clear>${tr("Position entfernen")}</button>`;
      footer.querySelector("[data-mi-clear]")?.addEventListener("click", () => {
        if (!confirm(tr("Position entfernen?"))) return;
        this._clearAccommodationPosition(scope);
        close();
      });
    }
    footer.querySelector("[data-mi-center]")?.addEventListener("click", () => {
      this.map.flyTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), 14) });
      close();
    });
  }

  /**
   * Fills the marker detail modal for a marked place (search result/POI).
   * Shows name/address/distance/coordinates and offers — with an open trip —
   * "as start/destination/waypoint", plus "open in maps" and "search here".
   */
  _fillPlaceInfo(r, titleEl, body, footer, close) {
    const lat = r.lat;
    const lon = r.lon;
    titleEl.textContent = r.name || "Ort";
    const addr = addressLine(r.name, r.displayName);
    const distLine =
      typeof r.distanceM === "number"
        ? `<div class="small text-secondary">${tr("Entfernung")}</div><div class="mb-2">${fmtDistance(r.distanceM)}</div>`
        : "";
    body.innerHTML = `
      <div class="mb-2"><span class="badge text-bg-secondary">${tr("Ort")}</span></div>
      ${addr ? `<div class="small text-secondary">${tr("Adresse")}</div><div class="mb-2">${esc(addr)}</div>` : ""}
      ${distLine}
      <div class="small text-secondary">${tr("Koordinaten")}</div>
      <div>${lat.toFixed(5)}, ${lon.toFixed(5)}</div>`;
    // Tour editing: no route yet (only start) → "set as destination",
    // otherwise "append as waypoint" (the appended point becomes the new destination).
    const tourAppendLabel = this.tourDraft && this.tourDraft.points.length < 2 ? tr("Als Ziel festlegen") : tr("Als Wegpunkt anhängen");
    // If a stage is selected, this place can be set directly as its destination
    // (route from its start to here). Primary action when a stage is selected.
    const selStage = this.trip && this._selectedStageId ? this.trip.stages.find((s) => s.id === this._selectedStageId) : null;
    const stageDestBtn = selStage ? `<button class="btn btn-sm btn-danger" data-pi-stage-dest>🏁 ${tr("Als Etappenziel")}</button>` : "";
    const tripActions = this.trip
      ? `${stageDestBtn}
         <button class="btn btn-sm btn-warning" data-pi-start-acc>🛏 ${tr("Als Start-Unterkunft")}</button>
         <button class="btn btn-sm btn-outline-primary" data-pi-slot="stop">➕ ${tr("Als Zwischenstopp")}</button>`
      : this.tourDraft
        ? `<button class="btn btn-sm btn-primary" data-pi-tour-append>${tourAppendLabel}</button>`
        : this.ridesStore
          ? `<button class="btn btn-sm btn-primary" data-pi-set-dest>${tr("🎯 Als Ziel festlegen")}</button>`
          : "";
    footer.innerHTML = `
      ${tripActions}
      <a class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener" href="${this._osmUrl(lat, lon)}">${tr("In Karten öffnen")}</a>
      <button class="btn btn-sm btn-outline-secondary" data-pi-here>${tr("🔍 Hier suchen")}</button>`;
    footer.querySelector("[data-pi-stage-dest]")?.addEventListener("click", () => {
      if (selStage) this._setStageDestination(selStage, r); // routes stage start → this place
      close();
    });
    footer.querySelector("[data-pi-start-acc]")?.addEventListener("click", () => {
      const t = this.trip;
      if (!t) return;
      // Take over the search result (hotel or similar) as the trip's start accommodation —
      // this is how a trip usually begins.
      t.startAccommodation = Trips.makeAccommodation({
        name: r.name || "",
        address: addressLine(r.name, r.displayName) || r.displayName || "",
        latitude: lat,
        longitude: lon,
      });
      this.store.touch();
      this._clearSearch();
      this.renderDetail();
      this.renderMap();
      this.tripOffcanvas.show(); // bring trip detail to the front (start accommodation is filled)
      close();
    });
    footer.querySelectorAll("[data-pi-slot]").forEach((b) =>
      b.addEventListener("click", () => {
        this._assignResultToTrip(r, b.dataset.piSlot); // takes over + closes search + opens trip detail
        close();
      }),
    );
    footer.querySelector("[data-pi-tour-append]")?.addEventListener("click", () => {
      this._addTourDraftPoint({ lng: lon, lat }); // append search result as a new tour waypoint
      this._clearSearch();
      close();
    });
    footer.querySelector("[data-pi-set-dest]")?.addEventListener("click", () => {
      this._clearSearch();
      close();
      this._setAsDestination({ lng: lon, lat }); // no start → location as start, result as destination
    });
    footer.querySelector("[data-pi-here]")?.addEventListener("click", () => {
      close();
      this.searchCenter = [lon, lat];
      const input = document.getElementById("nav-search");
      if (input && input.value.trim()) this.runSearch(input.value, [lon, lat]);
      else input?.focus();
    });
  }

  /** Removes a waypoint (start/destination/intermediate stop) and redraws. */
  _removeWaypoint(role, id) {
    const t = this.trip;
    if (!t) return;
    if (role === "start") t.startWaypoint = null;
    else if (role === "end") t.endWaypoint = null;
    else t.intermediateStops = t.intermediateStops.filter((s) => s.id !== id);
    this.store.touch();
    this.renderDetail();
    this.renderMap();
  }

  /** Clears the coordinate of an accommodation (start/stage) — an empty one becomes null. */
  _clearAccommodationPosition(scope) {
    const t = this.trip;
    if (!t) return;
    const stage = scope.type === "stage" ? t.stages.find((s) => s.id === scope.stageId) : null;
    const acc = scope.type === "start" ? t.startAccommodation : stage?.accommodation;
    if (!acc) return;
    acc.latitude = null;
    acc.longitude = null;
    const cleaned = Trips.accommodationIsEmpty(acc) ? null : acc;
    if (scope.type === "start") t.startAccommodation = cleaned;
    else if (stage) stage.accommodation = cleaned;
    this.store.touch();
    this.renderDetail();
    this.renderMap();
  }

  renderMap(opts = {}) {
    // Default: NO re-centering — the camera stays where the user is (otherwise
    // it jumps to the trip start on every change via store.touch→onChange).
    // Only opts.recenter=true (exclusively when OPENING a trip) re-centers.
    // Keep the trip-planning mode indicator in sync (visible while a trip is open).
    this._renderTripModeIndicator();
    // Re-place the markers.
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    const t = this.trip;
    if (!t) {
      this._setRoute([]);
      this._setTemplate([]);
      this._highlightStageId = null;
      this._selectedStageId = null;
      this._selectedLeg = null;
      this._setLegHighlight([]);
      this._setStageHighlight([]);
      return;
    }
    // Draw the assigned template in red (lies below the stage routes).
    this._setTemplate(this._templateCoords(t));
    // Waypoint markers (start green / destination red / intermediate stops blue). Determine
    // the role by identity so that a missing start/destination does not shift the assignment.
    const pts = this._orderedWaypoints(t);
    pts.forEach((wp) => {
      let role = "stop";
      let index = 0;
      if (wp === t.startWaypoint) role = "start";
      else if (wp === t.endWaypoint) role = "end";
      else index = t.intermediateStops.indexOf(wp);
      const color = role === "start" ? "#198754" : role === "end" ? "#dc3545" : "#0d6efd";
      const marker = new maplibregl.Marker({ color, draggable: true, subpixelPositioning: true }).setLngLat([wp.longitude, wp.latitude]).addTo(this.map);
      this._wireMarker(marker, {
        title: wp.name || "",
        onClick: () => this._showMarkerInfo({ kind: "waypoint", wp, role, index, stopCount: t.intermediateStops.length }),
        onDragEnd: (ll) => this._onWaypointDragged(t, wp, ll),
      });
      this.markers.push(marker);
    });
    // Komoot-style: small handles in the middle of each waypoint segment. Dragging
    // inserts a new intermediate stop at that spot (insert index =
    // number of stops to the left of the segment, so the order is correct).
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      let insertIndex = 0;
      for (let k = 0; k <= i; k++) {
        if (pts[k] !== t.startWaypoint && pts[k] !== t.endWaypoint) insertIndex++;
      }
      const handleEl = document.createElement("div");
      handleEl.className = "gc-insert-handle";
      handleEl.title = tr("Ziehen, um hier einen Zwischenstopp einzufügen");
      const handle = new maplibregl.Marker({ element: handleEl, draggable: true, subpixelPositioning: true })
        .setLngLat([(a.longitude + b.longitude) / 2, (a.latitude + b.latitude) / 2])
        .addTo(this.map);
      handle.on("dragend", () => this._insertStopAt(insertIndex, handle.getLngLat()));
      this.markers.push(handle);
    }
    // Located accommodations (start + stages) as orange bed markers.
    const accs = [];
    if (t.startAccommodation) accs.push({ a: t.startAccommodation, label: "Start-Unterkunft", scope: { type: "start" } });
    for (const s of t.stages) {
      if (s.accommodation) accs.push({ a: s.accommodation, label: s.title || "Etappe", scope: { type: "stage", stageId: s.id } });
    }
    for (const { a, label, scope } of accs) {
      if (a.latitude == null || a.longitude == null) continue;
      let accMarker;
      if (scope.type === "start") {
        // Start accommodation as an orange plaque with a clear START label.
        const el = document.createElement("div");
        el.className = "gc-acc-start-marker";
        el.innerHTML = `<span class="gc-acc-bed">🛏</span><span class="gc-acc-tag">START</span>`;
        accMarker = new maplibregl.Marker({ element: el, draggable: true, subpixelPositioning: true }).setLngLat([a.longitude, a.latitude]).addTo(this.map);
      } else {
        accMarker = new maplibregl.Marker({ color: "#fd7e14", draggable: true, subpixelPositioning: true }).setLngLat([a.longitude, a.latitude]).addTo(this.map);
      }
      this._wireMarker(accMarker, {
        title: `🛏 ${a.name || label}`,
        onClick: () => this._showMarkerInfo({ kind: "accommodation", acc: a, label, scope }),
        onDragEnd: (ll) => this._onAccommodationDragged(t, a, ll),
      });
      this.markers.push(accMarker);
    }
    if (opts.recenter && pts.length >= 1) {
      this.map.flyTo({ center: [pts[0].longitude, pts[0].latitude], zoom: Math.max(this.map.getZoom(), 9) });
    }

    // Prefer drawing the persisted stage routes; otherwise a
    // live preview over the waypoints.
    const stageLines = [];
    if (this.ridesStore) {
      for (const s of t.stages) {
        const ride = s.plannedRouteRef ? this.ridesStore.getRide(s.plannedRouteRef.rideId) : null;
        if (ride && ride.samples.length >= 2) {
          stageLines.push(ride.samples.map((sm) => [sm.longitude, sm.latitude]));
        }
      }
    }
    if (stageLines.length) this._setRouteLines(stageLines);
    else this._updateRoute(pts);

    // Numbered, clickable stage markers (1,2,3 …) in the middle of each
    // stage route. Click selects the stage (route highlight + side menu) and
    // opens a short info dialog. `_stageMarkerEls` allows toggling
    // the selection look WITHOUT renderMap (which would re-center the map).
    this._stageMarkerEls = new Map();
    if (this.ridesStore) {
      t.stages.forEach((s, i) => {
        const ride = s.plannedRouteRef ? this.ridesStore.getRide(s.plannedRouteRef.rideId) : null;
        if (!ride || ride.samples.length < 2) return;
        const mid = ride.samples[Math.floor(ride.samples.length / 2)];
        const elx = document.createElement("div");
        elx.className = "gc-stage-marker" + (s.id === this._selectedStageId ? " selected" : "");
        elx.textContent = String(i + 1);
        elx.title = `${tr("Etappe")} ${i + 1}`;
        const marker = new maplibregl.Marker({ element: elx }).setLngLat([mid.longitude, mid.latitude]).addTo(this.map);
        elx.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._selectStage(s);
          this._showMarkerInfo({ kind: "stage", stage: s, num: i + 1, lat: mid.latitude, lng: mid.longitude });
        });
        this._stageMarkerEls.set(s.id, elx);
        this.markers.push(marker);
      });
      // Explicit intermediate stops per stage as small markers (the route passes
      // through). Click removes the stop (with confirmation) and re-routes.
      t.stages.forEach((s) => {
        (s.waypoints || []).forEach((w, vi) => {
          if (w.latitude == null || w.longitude == null) return;
          const elx = document.createElement("div");
          elx.className = "gc-via-marker";
          elx.title = w.name || tr("Zwischenstopp");
          const marker = new maplibregl.Marker({ element: elx }).setLngLat([w.longitude, w.latitude]).addTo(this.map);
          elx.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (!confirm(tr("Zwischenstopp entfernen?"))) return;
            s.waypoints.splice(vi, 1);
            this.store.touch();
            this._recomputeStageWithVias(t, s);
          });
          this.markers.push(marker);
        });
      });

      // Section markers of the SELECTED stage: one clickable marker per leg
      // (🧭 template / 📏 direct) in the middle of the leg piece. Only useful
      // with a template. Click opens the choice template ⇄ direct for this section.
      const selS = this._selectedStageId ? t.stages.find((x) => x.id === this._selectedStageId) : null;
      const selRide = selS && selS.plannedRouteRef ? this.ridesStore.getRide(selS.plannedRouteRef.rideId) : null;
      if (selS && t.assignedRouteId && selRide && selRide.samples.length >= 2) {
        const sc = selRide.samples.map((sm) => [sm.longitude, sm.latitude]);
        const pts = [sc[0], ...(selS.waypoints || []).map((w) => [w.longitude, w.latitude]), sc[sc.length - 1]];
        const idxOf = pts.map((p) => nearestIndex(sc, p));
        const legDir = this._stageLegDirect(selS);
        const epNames = [this._stageEndpoints(t, selS, t.stages.indexOf(selS)).start, ...(selS.waypoints || []).map((w) => w.name), this._stageEndpoints(t, selS, t.stages.indexOf(selS)).end];
        // Piece of a leg (slice of the stage geometry) for the yellow highlight.
        const legSlice = (li) => sc.slice(Math.min(idxOf[li], idxOf[li + 1]), Math.max(idxOf[li], idxOf[li + 1]) + 1);
        for (let li = 0; li < legDir.length; li++) {
          const midIdx = Math.floor((idxOf[li] + idxOf[li + 1]) / 2);
          const c = sc[midIdx];
          if (!c) continue;
          const elx = document.createElement("div");
          const selected = this._selectedLeg && this._selectedLeg.stageId === selS.id && this._selectedLeg.legIndex === li;
          elx.className = "gc-leg-marker" + (legDir[li] ? " direct" : "") + (selected ? " selected" : "");
          elx.textContent = legDir[li] ? "📏" : "🧭";
          const legIndex = li;
          const destName = epNames[li + 1] || tr("Ziel");
          const marker = new maplibregl.Marker({ element: elx }).setLngLat(c).addTo(this.map);
          elx.addEventListener("click", (ev) => {
            ev.stopPropagation();
            this._selectedLeg = { stageId: selS.id, legIndex }; // remember section → yellow
            this._setLegHighlight(legSlice(legIndex));
            this._showMarkerInfo({ kind: "leg", stage: selS, legIndex, destName, lat: c[1], lng: c[0] });
          });
          this.markers.push(marker);
        }
        // Keep the yellow highlight of the selected section across redraws.
        if (this._selectedLeg && this._selectedLeg.stageId === selS.id && this._selectedLeg.legIndex < legDir.length) {
          this._setLegHighlight(legSlice(this._selectedLeg.legIndex));
        } else {
          this._selectedLeg = null;
          this._setLegHighlight([]);
        }
      } else {
        this._selectedLeg = null;
        this._setLegHighlight([]);
      }
    }

    // Keep a previously highlighted stage across redraws; if it no longer belongs
    // to the (possibly switched) trip or has no route → clear it.
    if (this._highlightStageId) {
      const s = t.stages.find((x) => x.id === this._highlightStageId);
      const ride = s && s.plannedRouteRef && this.ridesStore ? this.ridesStore.getRide(s.plannedRouteRef.rideId) : null;
      if (ride && ride.samples.length >= 2) this._setStageHighlight(ride.samples.map((sm) => [sm.longitude, sm.latitude]));
      else {
        this._highlightStageId = null;
        this._setStageHighlight([]);
      }
    }
  }

  _setRouteLines(lines) {
    this._ensureRouteLayer();
    const src = this.map.getSource("trip-route");
    if (!src) return;
    src.setData(
      lines.length
        ? { type: "Feature", geometry: { type: "MultiLineString", coordinates: lines } }
        : { type: "FeatureCollection", features: [] },
    );
  }

  /** Updates the routing configuration and redraws the route. */
  setRoutingConfig(cfg) {
    this.routingConfig = cfg;
    if (this.trip) this._updateRoute(this._orderedWaypoints(this.trip));
  }

  async _updateRoute(pts) {
    if (pts.length < 2) {
      this._setRoute([]);
      return;
    }
    const result = await computeRoute(this.routingConfig, pts);
    this._setRoute(result ? result.coordinates : []); // without a route only the markers remain
  }

  _setRoute(coordinates) {
    this._ensureRouteLayer();
    const src = this.map.getSource("trip-route");
    if (!src) return;
    src.setData(
      coordinates.length
        ? { type: "Feature", geometry: { type: "LineString", coordinates } }
        : { type: "FeatureCollection", features: [] },
    );
  }

  clear() {
    this.selectedId = null;
    this.pickMode = null;
    this._setBanner("");
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    this._clearSearch();
    this._setRoute([]);
    if (this.tripsListEl) this.tripsListEl.innerHTML = "";
    if (this.detailEl) this.detailEl.innerHTML = "";
  }
}
