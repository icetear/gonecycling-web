// Trip data model + logic of the web app — ported from the iOS app (Trip.swift /
// TripStore.swift), so that encrypted, synchronized trips are interpreted
// identically between app and web.
//
// Pure ES module WITHOUT imports (embeddable in the browser via import map,
// testable in Node by path). The JSON (de)serialization is deliberately
// compatible with the iOS app's standard `JSONEncoder`/`JSONDecoder`:
//   • Date  → Double = seconds since 2001-01-01 00:00:00 UTC (reference date)
//   • UUID  → uppercase string
//   • Enum  → rawValue string ("planned" …)
//   • nil optionals are omitted (like encodeIfPresent)

// --- Constants -------------------------------------------------------------

// Unix seconds of 2001-01-01T00:00:00Z. Swift's Date reference.
const SWIFT_EPOCH_OFFSET = 978307200;
const DAY_MS = 86400000;

export const TripStageStatus = Object.freeze({
  planned: "planned",
  active: "active",
  completed: "completed",
});

// --- Date helpers (Swift-compatible, day math in UTC for determinism) -----

/** JS Date → Swift Double (seconds since 2001). */
export function dateToSwift(date) {
  return date.getTime() / 1000 - SWIFT_EPOCH_OFFSET;
}

/** Swift Double → JS Date. */
export function swiftToDate(value) {
  return new Date((value + SWIFT_EPOCH_OFFSET) * 1000);
}

/** Normalize Date to UTC midnight (for day-accurate planning, DST-safe). */
export function startOfDayUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** New (Swift-style) UUID in uppercase. */
export function newId() {
  return globalThis.crypto.randomUUID().toUpperCase();
}

// --- Factory functions (defaults as in Swift) -----------------------------

export function makeWaypoint({ id = newId(), name = "", latitude, longitude }) {
  return { id, name, latitude, longitude };
}

export function makeAccommodation(p = {}) {
  return {
    name: p.name ?? "",
    address: p.address ?? "",
    notes: p.notes ?? "",
    isBooked: p.isBooked ?? false,
    checkInTime: p.checkInTime ?? null, // Date|null
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    price: p.price ?? null, // number|null (total price per stay)
  };
}

/** True if nothing meaningful is set on the accommodation (→ store as null). */
export function accommodationIsEmpty(a) {
  if (!a) return true;
  const blank = [a.name, a.address, a.notes].every((s) => !s || !s.trim());
  return blank && !a.isBooked && a.checkInTime == null && a.latitude == null && a.longitude == null && a.price == null;
}

export function makeStage(p = {}) {
  return {
    id: p.id ?? newId(),
    title: p.title ?? "",
    notes: p.notes ?? "",
    status: p.status ?? TripStageStatus.planned,
    plannedRouteRef: p.plannedRouteRef ?? null, // { rideId } | null
    completedAt: p.completedAt ?? null,
    accommodation: p.accommodation ?? null,
    overnightStays: p.overnightStays ?? 1,
    // Intermediate stops of the stage; each waypoint can carry `directIn` = the leg
    // FROM its predecessor to it ignores the template (shortest route).
    waypoints: p.waypoints ?? [],
    directToEnd: p.directToEnd ?? p.directRoute ?? false, // last leg (→ destination) direct?
  };
}

export function makeExpense(p = {}) {
  return {
    id: p.id ?? newId(),
    title: p.title ?? "",
    amount: p.amount ?? 0, // may be negative
    date: p.date ?? null,
    participantId: p.participantId ?? null,
  };
}

export function makeParticipant({ id = newId(), name = "" }) {
  return { id, name };
}

export function makeTrip(p = {}) {
  return {
    id: p.id ?? newId(),
    title: p.title ?? "",
    notes: p.notes ?? "",
    createdAt: p.createdAt ?? new Date(),
    stages: p.stages ?? [],
    assignedRouteId: p.assignedRouteId ?? null,
    startWaypoint: p.startWaypoint ?? null,
    endWaypoint: p.endWaypoint ?? null,
    intermediateStops: p.intermediateStops ?? [],
    plannedStartDate: p.plannedStartDate ?? null, // Date|null (arrival day)
    startAccommodation: p.startAccommodation ?? null,
    startNights: p.startNights ?? 0,
    expenses: p.expenses ?? [],
    participants: p.participants ?? [],
    // Web extension: transport mode of the trip (default bicycle). Flows into the
    // generated stage routes (RideSession.transportMode). iOS does not know this
    // field on the Trip and ignores it when decoding.
    transportMode: p.transportMode ?? "cycling",
  };
}

/** Available transport modes (rawValues identical to the iOS app). */
export const TRANSPORT_MODES = ["cycling", "hiking", "car", "eScooter", "eBike", "motorcycle", "skateboard"];

// --- Derived logic (port of the Trip extensions in Trip.swift) -------------

/**
 * Concrete calendar days per stage (in stage order). Stage i =
 * plannedStartDate + startNights + Σ overnightStays of the previous stages.
 * [] if no planned start is set.
 */
export function stageDates(trip) {
  if (!trip.plannedStartDate) return [];
  const day0 = startOfDayUTC(trip.plannedStartDate);
  const dates = [];
  let offset = Math.max(0, trip.startNights || 0);
  for (const stage of trip.stages) {
    dates.push(addDaysUTC(day0, offset));
    offset += Math.max(1, stage.overnightStays || 1);
  }
  return dates;
}

export function dateForStage(trip, stageId) {
  const idx = trip.stages.findIndex((s) => s.id === stageId);
  if (idx < 0) return null;
  const dates = stageDates(trip);
  return dates[idx] ?? null;
}

/** Trip end = day0 + (startNights + Σ overnightStays). null without start/stages. */
export function plannedEndDate(trip) {
  if (!trip.plannedStartDate || trip.stages.length === 0) return null;
  const day0 = startOfDayUTC(trip.plannedStartDate);
  const total = Math.max(0, trip.startNights || 0) +
    trip.stages.reduce((sum, s) => sum + Math.max(1, s.overnightStays || 1), 0);
  return addDaysUTC(day0, total);
}

/** Time span of the start stay or null (no start / 0 nights). */
export function startStayDates(trip) {
  if (!trip.plannedStartDate || !(trip.startNights > 0)) return null;
  const day0 = startOfDayUTC(trip.plannedStartDate);
  return { start: day0, end: addDaysUTC(day0, trip.startNights) };
}

/** Sum of the accommodation costs (start + stages); prices are total amounts. */
export function accommodationCostTotal(trip) {
  let sum = trip.startAccommodation?.price ?? 0;
  for (const stage of trip.stages) sum += stage.accommodation?.price ?? 0;
  return sum;
}

/** Sum of all expenses (sign-correct). */
export function expensesTotal(trip) {
  return trip.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
}

/** Total cost = accommodations + expenses. */
export function totalCost(trip) {
  return accommodationCostTotal(trip) + expensesTotal(trip);
}

/**
 * Actually assigned participant of an expense:
 * 0 participants → null; exactly 1 → that one; >1 → the one referenced by participantId.
 */
export function effectiveParticipant(trip, expense) {
  const ps = trip.participants;
  if (!ps || ps.length === 0) return null;
  if (ps.length === 1) return ps[0];
  return ps.find((p) => p.id === expense.participantId) ?? null;
}

// --- Serialization (Swift-JSONEncoder-compatible) --------------------------

function putDate(obj, key, date) {
  if (date != null) obj[key] = dateToSwift(date instanceof Date ? date : new Date(date));
}
function putOpt(obj, key, value) {
  if (value != null) obj[key] = value;
}

function waypointToJSON(w) {
  return { id: w.id, name: w.name, latitude: w.latitude, longitude: w.longitude };
}

function accommodationToJSON(a) {
  const o = { name: a.name, address: a.address, notes: a.notes, isBooked: a.isBooked };
  putDate(o, "checkInTime", a.checkInTime);
  putOpt(o, "latitude", a.latitude);
  putOpt(o, "longitude", a.longitude);
  putOpt(o, "price", a.price);
  return o;
}

function stageToJSON(s) {
  const o = { id: s.id, title: s.title, notes: s.notes, status: s.status };
  if (s.plannedRouteRef) o.plannedRouteRef = { rideId: s.plannedRouteRef.rideId };
  putDate(o, "completedAt", s.completedAt);
  if (s.accommodation) o.accommodation = accommodationToJSON(s.accommodation);
  o.overnightStays = s.overnightStays;
  if (s.waypoints && s.waypoints.length) o.waypoints = s.waypoints.map((w) => ({ ...waypointToJSON(w), direct: !!w.directIn }));
  if (s.directToEnd) o.directToEnd = true;
  return o;
}

function expenseToJSON(e) {
  const o = { id: e.id, title: e.title, amount: e.amount };
  putDate(o, "date", e.date);
  putOpt(o, "participantId", e.participantId);
  return o;
}

/** A trip → Swift-compatible plain object. */
export function tripToJSON(t) {
  const o = { id: t.id, title: t.title, notes: t.notes };
  o.createdAt = dateToSwift(t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt));
  o.stages = t.stages.map(stageToJSON);
  putOpt(o, "assignedRouteId", t.assignedRouteId);
  if (t.startWaypoint) o.startWaypoint = waypointToJSON(t.startWaypoint);
  if (t.endWaypoint) o.endWaypoint = waypointToJSON(t.endWaypoint);
  o.intermediateStops = t.intermediateStops.map(waypointToJSON);
  putDate(o, "plannedStartDate", t.plannedStartDate);
  if (t.startAccommodation) o.startAccommodation = accommodationToJSON(t.startAccommodation);
  o.startNights = t.startNights;
  o.expenses = t.expenses.map(expenseToJSON);
  o.participants = t.participants.map((p) => ({ id: p.id, name: p.name }));
  if (t.transportMode) o.transportMode = t.transportMode;
  return o;
}

// --- Deserialization (tolerant like decodeIfPresent) ------------------------

function getDate(value) {
  return value == null ? null : swiftToDate(value);
}

function accommodationFromJSON(o) {
  if (!o) return null;
  return {
    name: o.name ?? "",
    address: o.address ?? "",
    notes: o.notes ?? "",
    isBooked: o.isBooked ?? false,
    checkInTime: getDate(o.checkInTime),
    latitude: o.latitude ?? null,
    longitude: o.longitude ?? null,
    price: o.price ?? null,
  };
}

function stageFromJSON(o) {
  return {
    id: o.id,
    title: o.title ?? "",
    notes: o.notes ?? "",
    status: o.status ?? TripStageStatus.planned,
    plannedRouteRef: o.plannedRouteRef ? { rideId: o.plannedRouteRef.rideId } : null,
    completedAt: getDate(o.completedAt),
    accommodation: accommodationFromJSON(o.accommodation),
    overnightStays: o.overnightStays ?? 1,
    waypoints: (o.waypoints ?? []).map((w) => ({ ...waypointFromJSON(w), directIn: !!w.direct })),
    directToEnd: o.directToEnd ?? o.directRoute ?? false,
  };
}

function waypointFromJSON(o) {
  return { id: o.id, name: o.name ?? "", latitude: o.latitude, longitude: o.longitude };
}

function expenseFromJSON(o) {
  return {
    id: o.id,
    title: o.title ?? "",
    amount: o.amount ?? 0,
    date: getDate(o.date),
    participantId: o.participantId ?? null,
  };
}

/** Swift-compatible plain object → trip. */
export function tripFromJSON(o) {
  return {
    id: o.id,
    title: o.title ?? "",
    notes: o.notes ?? "",
    createdAt: getDate(o.createdAt) ?? new Date(),
    stages: (o.stages ?? []).map(stageFromJSON),
    assignedRouteId: o.assignedRouteId ?? null,
    startWaypoint: o.startWaypoint ? waypointFromJSON(o.startWaypoint) : null,
    endWaypoint: o.endWaypoint ? waypointFromJSON(o.endWaypoint) : null,
    intermediateStops: (o.intermediateStops ?? []).map(waypointFromJSON),
    plannedStartDate: getDate(o.plannedStartDate),
    startAccommodation: accommodationFromJSON(o.startAccommodation),
    startNights: o.startNights ?? 0,
    expenses: (o.expenses ?? []).map(expenseFromJSON),
    participants: (o.participants ?? []).map((p) => ({ id: p.id, name: p.name ?? "" })),
    transportMode: o.transportMode ?? "cycling",
  };
}

/** List of trips ⇄ array of plain objects (= content of trips.json). */
export function tripsToArray(trips) {
  return trips.map(tripToJSON);
}
export function tripsFromArray(arr) {
  return (arr ?? []).map(tripFromJSON);
}
