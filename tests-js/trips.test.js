// Tests of the trip model (static/js/trips.js) — mirror the iOS logic tests
// (ModelPersistenceTests) and check the Swift-compatible serialization/interop.
import { test } from "node:test";
import assert from "node:assert/strict";

import * as T from "../static/js/trips.js";
import * as gcCrypto from "../static/js/crypto.js";
import { SyncClient } from "../static/js/sync.js";

const DAY = 86400000;
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

const BASE = process.env.GC_BASE_URL || "http://127.0.0.1:8011/api/v1";
let serverUp = false;
try {
  serverUp = (await fetch(BASE + "/health")).ok;
} catch {
  serverUp = false;
}
const skipIntegration = serverUp ? false : `Server nicht erreichbar (${BASE})`;

// --- Derived logic ------------------------------------------------------

test("stageDates: Start-Nächte verschieben Etappe 0 + Folge-Etappen", () => {
  const day0 = utc(2026, 6, 14);
  const trip = T.makeTrip({
    plannedStartDate: day0,
    startNights: 2,
    stages: [T.makeStage({ overnightStays: 1 }), T.makeStage({ overnightStays: 3 })],
  });
  const dates = T.stageDates(trip);
  assert.equal(dates.length, 2);
  assert.equal(dates[0].getTime(), day0.getTime() + 2 * DAY); // + startNights
  assert.equal(dates[1].getTime(), day0.getTime() + 3 * DAY); // + stage0 night
  assert.equal(T.plannedEndDate(trip).getTime(), day0.getTime() + 6 * DAY); // 2+1+3
});

test("stageDates: ohne Start-Nächte unverändert", () => {
  const day0 = utc(2026, 6, 14);
  const trip = T.makeTrip({ plannedStartDate: day0, stages: [T.makeStage({ overnightStays: 1 })] });
  assert.equal(T.stageDates(trip)[0].getTime(), day0.getTime());
});

test("startStayDates: Spanne nur mit Start + Nächten", () => {
  const day0 = utc(2026, 6, 14);
  assert.equal(T.startStayDates(T.makeTrip({ plannedStartDate: day0 })), null);
  const span = T.startStayDates(T.makeTrip({ plannedStartDate: day0, startNights: 2 }));
  assert.equal(span.start.getTime(), day0.getTime());
  assert.equal(span.end.getTime(), day0.getTime() + 2 * DAY);
});

test("totalCost = Unterkünfte (Start + Etappen) + Ausgaben", () => {
  const trip = T.makeTrip({
    startAccommodation: T.makeAccommodation({ name: "Hotel", price: 180 }),
    startNights: 1,
    stages: [
      T.makeStage({ accommodation: T.makeAccommodation({ name: "Pension", price: 95 }) }),
      T.makeStage({ accommodation: T.makeAccommodation({ name: "Hostel" }) }), // no price
    ],
    expenses: [T.makeExpense({ title: "Fähre", amount: 89 }), T.makeExpense({ title: "Gutschrift", amount: -12 })],
  });
  assert.equal(T.accommodationCostTotal(trip), 275);
  assert.equal(T.expensesTotal(trip), 77);
  assert.equal(T.totalCost(trip), 352);
});

test("effectiveParticipant: 0 → null, 1 → dieser, >1 → referenzierter", () => {
  const anna = T.makeParticipant({ name: "Anna" });
  const tom = T.makeParticipant({ name: "Tom" });
  const assigned = T.makeExpense({ title: "Essen", amount: 20, participantId: tom.id });
  const unassigned = T.makeExpense({ title: "Bahn", amount: 5 });

  assert.equal(T.effectiveParticipant(T.makeTrip({ expenses: [assigned] }), assigned), null);
  assert.equal(
    T.effectiveParticipant(T.makeTrip({ participants: [anna], expenses: [assigned] }), assigned).id,
    anna.id,
  );
  const multi = T.makeTrip({ participants: [anna, tom], expenses: [assigned, unassigned] });
  assert.equal(T.effectiveParticipant(multi, assigned).id, tom.id);
  assert.equal(T.effectiveParticipant(multi, unassigned), null);
});

// --- Serialization (Swift-compatible) -------------------------------------

test("tripToJSON: Dates als 2001-Double, nil-Optionals weggelassen", () => {
  const trip = T.makeTrip({ title: "Leer", createdAt: utc(2026, 1, 1) });
  const json = T.tripToJSON(trip);
  assert.equal(typeof json.createdAt, "number"); // Double, not an ISO string
  assert.ok(!("plannedStartDate" in json)); // null → omitted
  assert.ok(!("startWaypoint" in json));
  assert.ok(!("startAccommodation" in json));
  assert.equal(json.startNights, 0); // required field stays
  assert.deepEqual(json.stages, []);
  assert.deepEqual(json.participants, []);
});

test("Date-Konvertierung passt zum Swift-Referenzdatum (2001-01-01)", () => {
  // 2001-01-01T00:00:00Z → 0; one day later → 86400.
  assert.equal(T.dateToSwift(utc(2001, 1, 1)), 0);
  assert.equal(T.dateToSwift(utc(2001, 1, 2)), 86400);
  assert.equal(T.swiftToDate(0).getTime(), utc(2001, 1, 1).getTime());
});

test("Round-trip: tripFromJSON(tripToJSON(t)) erhält Felder + Kosten", () => {
  const trip = T.makeTrip({
    title: "Donauradweg",
    plannedStartDate: utc(2026, 6, 14),
    startNights: 2,
    startAccommodation: T.makeAccommodation({ name: "Hotel Adler", price: 180, isBooked: true }),
    stages: [T.makeStage({ title: "A – B", overnightStays: 1, accommodation: T.makeAccommodation({ name: "Pension", price: 95 }) })],
    expenses: [T.makeExpense({ title: "Fähre", amount: 89, date: utc(2026, 6, 15) })],
    participants: [T.makeParticipant({ name: "Anna" })],
  });
  const back = T.tripFromJSON(JSON.parse(JSON.stringify(T.tripToJSON(trip))));
  assert.equal(back.title, "Donauradweg");
  assert.equal(back.startNights, 2);
  assert.equal(back.startAccommodation.price, 180);
  assert.equal(back.startAccommodation.isBooked, true);
  assert.equal(back.stages[0].accommodation.price, 95);
  assert.equal(back.expenses[0].amount, 89);
  assert.equal(back.plannedStartDate.getTime(), utc(2026, 6, 14).getTime());
  assert.equal(T.totalCost(back), 364); // 180 + 95 + 89
});

test("Unterkunft: Adresse/Notizen/Check-in/gebucht überstehen den Round-trip", () => {
  const checkIn = utc(2026, 6, 14); // time part doesn't matter — only that the Date passes through
  const trip = T.makeTrip({
    startAccommodation: T.makeAccommodation({
      name: "Hotel Adler",
      address: "Hauptstr. 1",
      notes: "Buchung 123",
      isBooked: true,
      checkInTime: checkIn,
      price: 120,
    }),
    startNights: 1,
  });
  const a = T.tripFromJSON(JSON.parse(JSON.stringify(T.tripToJSON(trip)))).startAccommodation;
  assert.equal(a.address, "Hauptstr. 1");
  assert.equal(a.notes, "Buchung 123");
  assert.equal(a.isBooked, true);
  assert.equal(a.checkInTime.getTime(), checkIn.getTime());
  assert.equal(a.price, 120);
});

test("transportMode: Default cycling + Round-trip", () => {
  assert.equal(T.makeTrip({}).transportMode, "cycling");
  const back = T.tripFromJSON(JSON.parse(JSON.stringify(T.tripToJSON(T.makeTrip({ transportMode: "hiking" })))));
  assert.equal(back.transportMode, "hiking");
});

test("Interop: parst eine Reise im iOS-Format (Double-Dates, omitted Optionals)", () => {
  // Just as the iOS JSONEncoder would write it.
  const iosTrip = {
    id: "33333333-3333-3333-3333-333333333333",
    title: "Alpenüberquerung",
    notes: "",
    createdAt: T.dateToSwift(utc(2026, 6, 1)),
    stages: [
      {
        id: "44444444-4444-4444-4444-444444444444",
        title: "München – Bad Tölz",
        notes: "",
        status: "completed",
        overnightStays: 1,
        accommodation: { name: "Gasthof", address: "", notes: "", isBooked: true, price: 70 },
      },
    ],
    intermediateStops: [],
    plannedStartDate: T.dateToSwift(utc(2026, 6, 22)),
    startNights: 0,
    expenses: [],
    participants: [],
    // startWaypoint/endWaypoint/startAccommodation deliberately omitted (nil in Swift)
  };
  const trip = T.tripFromJSON(iosTrip);
  assert.equal(trip.title, "Alpenüberquerung");
  assert.equal(trip.stages[0].status, "completed");
  assert.equal(trip.stages[0].accommodation.price, 70);
  assert.equal(trip.startWaypoint, null);
  assert.equal(trip.plannedStartDate.getTime(), utc(2026, 6, 22).getTime());
  // Stage 0 at the planned start (startNights 0).
  assert.equal(T.stageDates(trip)[0].getTime(), utc(2026, 6, 22).getTime());
});

// --- Integration: trips encrypted via the real sync API ------------

test("Integration: trips-Blob verschlüsselt push/pull + entschlüsselt korrekt", { skip: skipIntegration }, async () => {
  const { authToken, encKey } = await gcCrypto.deriveKeys(gcCrypto.generateMasterSecret());
  const client = new SyncClient(BASE, authToken);
  await client.pair();

  const trips = [
    T.makeTrip({
      title: "Donauradweg",
      plannedStartDate: utc(2026, 6, 14),
      startNights: 2,
      startAccommodation: T.makeAccommodation({ name: "Hotel Adler", price: 180 }),
      stages: [T.makeStage({ title: "A – B", overnightStays: 1, accommodation: T.makeAccommodation({ name: "Pension", price: 95 }) })],
      expenses: [T.makeExpense({ title: "Fähre", amount: 89 })],
    }),
  ];

  // Encrypt like the browser TripsStore: tripsToArray → encryptJSON("trips").
  const blob = await gcCrypto.encryptJSON(encKey, "trips", T.tripsToArray(trips));
  await client.push("trips", blob);

  const pulled = await client.pull("trips");
  // Server only stores ciphertext (no plaintext marker).
  assert.ok(!Buffer.from(pulled.blob).toString("latin1").includes("Donauradweg"));

  const back = T.tripsFromArray(await gcCrypto.decryptJSON(encKey, "trips", pulled.blob));
  assert.equal(back.length, 1);
  assert.equal(back[0].title, "Donauradweg");
  assert.equal(back[0].startNights, 2);
  assert.equal(T.totalCost(back[0]), 364); // 180 + 95 + 89

  await client.deleteVault();
});
