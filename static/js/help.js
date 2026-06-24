// Help/info content of the GoneCycling web planner. Long texts live HERE on
// purpose (bilingual de/en objects) instead of as data-i18n keys in the
// dictionary — this keeps i18n.js lean and the completeness tests focused on UI chrome.
// `renderHelp(lang)` builds Bootstrap pills (section sidebar) + tab content; the
// section switching is handled by Bootstrap itself (data-bs-toggle="pill").
//
// Imprint: operator name/address are PLACEHOLDERS (`[…]`) — replace them with the
// real legal data before going live (the contact email is already set).

/** Contact/imprint data in ONE place — to be filled in by the operator
 *  (legally required in Germany for a publicly reachable instance). */
export const IMPRINT = {
  operator: "Your Name",
  street: "Your Street 1",
  city: "12345 Your City",
  country: "Your Country",
  email: "admin@example.com",
};

/**
 * Help sections. Each entry: stable `id`, `title` (de/en, sidebar) and
 * `body` (de/en, HTML). Order = sidebar order; the first one is active.
 */
export const HELP = [
  {
    id: "grundlagen",
    title: { de: "Grundlagen", en: "Basics" },
    body: {
      de: `
        <p>GoneCycling Web ist ein <strong>Routen- und Reiseplaner</strong> für Fahrrad, Wandern, Auto u. v. m. — als Begleiter zur GoneCycling-iPhone-App. Du planst direkt auf der Karte, <strong>ohne Konto und ohne Zwang zur Cloud</strong>.</p>
        <ul>
          <li><strong>Offline-first:</strong> Reisen und Touren werden lokal im Browser gespeichert (localStorage). Die Planung funktioniert ohne Anmeldung.</li>
          <li><strong>Karte bedienen:</strong> Klick auf die Karte öffnet ein Info-Fenster (Ort/Adresse) mit Aktionen wie <em>„Als Ziel festlegen"</em> oder <em>„Hier Wegpunkt einfügen"</em>.</li>
          <li><strong>Suche:</strong> Oben links Orte/POIs suchen. Treffer lassen sich anfliegen oder direkt als Start/Ziel/Wegpunkt übernehmen.</li>
          <li><strong>POI-Leiste:</strong> Unter der Suche findest du Schnellziele (z. B. Bäckerei, Tankstelle) für den aktuellen Kartenausschnitt — pflegbar in den Einstellungen.</li>
          <li><strong>Fadenkreuz ⌖:</strong> Überall, wo ein Wegpunkt, Etappenziel oder Startort steht, springt ein Klick auf das Fadenkreuz direkt dorthin auf der Karte.</li>
        </ul>`,
      en: `
        <p>GoneCycling Web is a <strong>route and trip planner</strong> for cycling, hiking, driving and more — a companion to the GoneCycling iPhone app. You plan right on the map, <strong>with no account and no forced cloud</strong>.</p>
        <ul>
          <li><strong>Offline-first:</strong> trips and tours are stored locally in your browser (localStorage). Planning works without signing in.</li>
          <li><strong>Using the map:</strong> clicking the map opens an info box (place/address) with actions like <em>"Set as destination"</em> or <em>"Insert waypoint here"</em>.</li>
          <li><strong>Search:</strong> find places/POIs at the top left. Results can be flown to or taken directly as start/destination/waypoint.</li>
          <li><strong>POI bar:</strong> below the search you'll find quick targets (e.g. bakery, gas station) for the current map view — editable in Settings.</li>
          <li><strong>Crosshair ⌖:</strong> wherever a waypoint, stage target or start is shown, clicking the crosshair jumps straight there on the map.</li>
        </ul>`,
    },
  },
  {
    id: "routing",
    title: { de: "Routing", en: "Routing" },
    body: {
      de: `
        <p>Routen werden über einen <strong>Routing-Anbieter</strong> berechnet. In den Einstellungen → <em>Routing</em> wählst du Anbieter, Server und Profil:</p>
        <ul>
          <li><strong>OSRM</strong> – schnell, einfache Profile (z. B. Rad/Auto).</li>
          <li><strong>OpenRouteService (ORS)</strong> – viele Profile; eigener Server per <em>API-Schlüssel</em> ODER <em>Benutzer/Passwort (Basic-Auth)</em>.</li>
          <li><strong>BRouter</strong> – sehr fahrradfreundlich, eigener Server/Profile.</li>
        </ul>
        <p><strong>Direkt-/Luftlinien-Override (📏):</strong> Nimmt das Routing einen bekannten Weg nicht, kannst du in der Wegpunktliste ein Teilstück auf Luftlinie umstellen — es wird dann gestrichelt gezeichnet.</p>
        <p><em>Hinweis:</em> Alle Routing-, Geocoding- und Kachel-Anfragen stellt dein <strong>Browser direkt</strong> an die jeweiligen Dienste (siehe Datenschutz).</p>`,
      en: `
        <p>Routes are computed via a <strong>routing provider</strong>. Under Settings → <em>Routing</em> you pick provider, server and profile:</p>
        <ul>
          <li><strong>OSRM</strong> – fast, simple profiles (e.g. bike/car).</li>
          <li><strong>OpenRouteService (ORS)</strong> – many profiles; your own server via <em>API key</em> OR <em>username/password (basic auth)</em>.</li>
          <li><strong>BRouter</strong> – very bike-friendly, your own server/profiles.</li>
        </ul>
        <p><strong>Direct / straight-line override (📏):</strong> if routing avoids a path you know is fine, switch a leg to a straight line in the waypoint list — it is then drawn dashed.</p>
        <p><em>Note:</em> all routing, geocoding and tile requests are made <strong>directly by your browser</strong> to the respective services (see Privacy).</p>`,
    },
  },
  {
    id: "ansichten",
    title: { de: "Ansichten", en: "Views" },
    body: {
      de: `
        <p>Du passt die Darstellung jederzeit an:</p>
        <ul>
          <li><strong>Kartenhintergrund:</strong> unten links über das Layer-Symbol wählbar — mehrere schlüsselfreie Anbieter (OpenStreetMap, CyclOSM, OpenTopoMap, Satellit u. a.).</li>
          <li><strong>Hell/Dunkel:</strong> der 🌙/☀️-Knopf in der Navigationsleiste; Standard folgt deiner Systemeinstellung.</li>
          <li><strong>Sprache:</strong> der EN/DE-Knopf schaltet Deutsch ⇄ Englisch; Standard ist deine Browsersprache.</li>
          <li><strong>Standort:</strong> das Standort-Symbol der Karte zentriert auf deine aktuelle Position.</li>
        </ul>`,
      en: `
        <p>You can adjust the presentation at any time:</p>
        <ul>
          <li><strong>Basemap:</strong> choose via the layer icon at the bottom left — several key-free providers (OpenStreetMap, CyclOSM, OpenTopoMap, satellite, …).</li>
          <li><strong>Light/Dark:</strong> the 🌙/☀️ button in the navbar; the default follows your system setting.</li>
          <li><strong>Language:</strong> the EN/DE button toggles German ⇄ English; the default is your browser language.</li>
          <li><strong>Location:</strong> the map's location control centres on your current position.</li>
        </ul>`,
    },
  },
  {
    id: "touren",
    title: { de: "Touren", en: "Tours" },
    body: {
      de: `
        <p>Eine <strong>Tour</strong> ist eine eigenständige Route (z. B. eine Radrunde). Touren findest du im Menü <em>„Touren"</em>.</p>
        <ul>
          <li><strong>Zeichnen:</strong> „+ Neue Tour" öffnet die Tour direkt auf der Karte. Klicks setzen Wegpunkte; die Route wird sofort entlang der Wege berechnet.</li>
          <li><strong>Bearbeiten:</strong> Knoten ziehen zum Verschieben, auf die Linie/leere Stelle klicken zum Einfügen/Anhängen. Die <strong>Wegpunktliste</strong> zeigt Distanzen und erlaubt Umsortieren/Löschen.</li>
          <li><strong>Transaktion:</strong> Änderungen werden mit <em>Speichern</em> übernommen, mit <em>Rückgängig</em> verworfen; <em>Original</em> stellt den Ausgangsstand wieder her (schützt importierte GPX-Spuren).</li>
          <li><strong>GPX-Import & Rundkurs:</strong> bestehende GPX-Dateien importieren oder einen Rundkurs um die Kartenmitte erzeugen.</li>
          <li><strong>Details:</strong> Distanz/Höhenmeter, Transportmittel, Bewertung, Notizen, Tags, GPX-Export.</li>
        </ul>`,
      en: `
        <p>A <strong>tour</strong> is a standalone route (e.g. a cycling loop). Find tours in the <em>"Tours"</em> menu.</p>
        <ul>
          <li><strong>Drawing:</strong> "+ New tour" opens the tour right on the map. Clicks add waypoints; the route is computed along the roads immediately.</li>
          <li><strong>Editing:</strong> drag a node to move it, click the line/an empty spot to insert/append. The <strong>waypoint list</strong> shows distances and lets you reorder/delete.</li>
          <li><strong>Transaction:</strong> changes are applied with <em>Save</em>, discarded with <em>Undo</em>; <em>Original</em> restores the starting state (protects imported GPX tracks).</li>
          <li><strong>GPX import & loop:</strong> import existing GPX files or generate a loop around the map centre.</li>
          <li><strong>Details:</strong> distance/elevation, mode of transport, rating, notes, tags, GPX export.</li>
        </ul>`,
    },
  },
  {
    id: "reisen",
    title: { de: "Reisen", en: "Trips" },
    body: {
      de: `
        <p>Eine <strong>Reise</strong> bündelt mehrere Etappen samt Unterkünften, Kosten und Teilnehmern. Reisen findest du im Menü <em>„Reisen"</em>.</p>
        <ul>
          <li><strong>Wegpunkte:</strong> Start, Ziel und Zwischenziele setzt du per Karte oder Suche; umsortieren mit ▲▼.</li>
          <li><strong>Etappen:</strong> jede Etappe hat Status, Übernachtungen und optional eine eigene Route („Route berechnen" oder vorhandene Tour wählen). Aus dem geplanten Start ergeben sich die Etappen-Daten.</li>
          <li><strong>Geführt – „Nächste Etappe":</strong> gib eine Wunschdistanz an; rundum werden Etappen-Ziele (Hotel/Bahnhof …), Pflicht-Stopps und Orte gesucht. Die Auswahl legt die Etappe an und rückt den Startpunkt weiter.</li>
          <li><strong>Auto-Etappen:</strong> teilt eine Strecke (Vorlage-Tour oder Start–Ziel) automatisch in Etappen.</li>
          <li><strong>Unterkünfte & Kosten:</strong> Start-Unterkunft und Etappen-Unterkünfte mit Preis; Ausgabenliste, Teilnehmer und Gesamtkosten.</li>
          <li><strong>Vorlage:</strong> eine Tour als rote Vorlage zuweisen, an der sich die Etappen orientieren.</li>
        </ul>`,
      en: `
        <p>A <strong>trip</strong> bundles several stages with accommodation, costs and travellers. Find trips in the <em>"Trips"</em> menu.</p>
        <ul>
          <li><strong>Waypoints:</strong> set start, destination and intermediate points via the map or search; reorder with ▲▼.</li>
          <li><strong>Stages:</strong> each stage has a status, overnight stays and optionally its own route ("Compute route" or pick an existing tour). Stage dates follow from the planned start.</li>
          <li><strong>Guided – "Next stage":</strong> enter a desired distance; targets around it (hotel/station …), mandatory stops and places are searched. Picking one creates the stage and advances the start point.</li>
          <li><strong>Auto stages:</strong> automatically split a route (template tour or start–destination) into stages.</li>
          <li><strong>Accommodation & costs:</strong> start and per-stage accommodation with price; an expense list, travellers and total cost.</li>
          <li><strong>Template:</strong> assign a tour as a red template that the stages follow.</li>
        </ul>`,
    },
  },
  {
    id: "sync",
    title: { de: "Synchronisation", en: "Sync" },
    body: {
      de: `
        <p>Optional kannst du deine Daten <strong>Ende-zu-Ende-verschlüsselt</strong> mit der GoneCycling-iPhone-App abgleichen — ganz ohne persönliches Konto.</p>
        <ul>
          <li><strong>Token statt Konto:</strong> ein zufälliger Schlüssel (per QR/Code) verbindet Web und App. Daraus wird lokal ein Verschlüsselungs-Schlüssel abgeleitet.</li>
          <li><strong>Zero-Knowledge:</strong> der Server speichert nur <strong>Chiffretext</strong> unter einem Token-Hash — er kann deine Reisen/Touren nicht lesen. Ver-/Entschlüsselung passiert ausschließlich in Browser und App.</li>
          <li><strong>Freiwillig:</strong> ohne „Verbinden" bleibt alles rein lokal. Trennen behält die lokalen Daten; Token-Wechsel widerruft den Zugriff.</li>
        </ul>`,
      en: `
        <p>Optionally you can sync your data <strong>end-to-end encrypted</strong> with the GoneCycling iPhone app — without any personal account.</p>
        <ul>
          <li><strong>Token instead of account:</strong> a random key (via QR/code) links web and app. An encryption key is derived from it locally.</li>
          <li><strong>Zero-knowledge:</strong> the server only stores <strong>ciphertext</strong> under a token hash — it cannot read your trips/tours. Encryption/decryption happens solely in your browser and the app.</li>
          <li><strong>Voluntary:</strong> without "Connect" everything stays purely local. Disconnecting keeps local data; rotating the token revokes access.</li>
        </ul>`,
    },
  },
  {
    id: "impressum",
    title: { de: "Impressum & Datenschutz", en: "Imprint & Privacy" },
    body: {
      de: `
        <h6 class="fw-bold">Impressum</h6>
        <p>Angaben gemäß § 5 DDG:</p>
        <p>${IMPRINT.operator}<br>${IMPRINT.street}<br>${IMPRINT.city}<br>${IMPRINT.country}</p>
        <p><strong>Kontakt:</strong> <a href="mailto:${IMPRINT.email}">${IMPRINT.email}</a></p>
        <hr>
        <h6 class="fw-bold">Datenschutzerklärung</h6>
        <p>GoneCycling Web ist eine clientseitige Anwendung. Deine Planungsdaten (Reisen, Touren, Einstellungen) bleiben <strong>lokal in deinem Browser</strong> (localStorage); sie werden nicht an uns übertragen.</p>
        <ul>
          <li><strong>Keine Konten, kein Tracking:</strong> keine Anmeldung, keine Analyse-/Werbe-Cookies, kein Profiling.</li>
          <li><strong>Direkte Dienste-Aufrufe:</strong> Karten-Kacheln, Adress-/POI-Suche (Nominatim/OpenStreetMap) und Routing (OSRM/OpenRouteService/BRouter) ruft dein <strong>Browser direkt</strong> bei den jeweiligen Anbietern ab. Dabei werden technisch bedingt deine IP-Adresse und die angefragten Koordinaten/Suchbegriffe an diese Dienste übermittelt; es gelten deren Datenschutzbestimmungen.</li>
          <li><strong>Optionaler Sync:</strong> nur wenn du aktiv „Verbinden" nutzt, werden <strong>Ende-zu-Ende-verschlüsselte</strong> Daten zum Sync-Server übertragen. Dieser speichert ausschließlich Chiffretext unter einem Token-Hash und kann die Inhalte nicht lesen.</li>
          <li><strong>Standort:</strong> die Geolokalisierung wird nur nach deiner Erlaubnis und nur lokal zum Zentrieren der Karte genutzt.</li>
          <li><strong>Deine Kontrolle:</strong> du kannst lokale Daten jederzeit exportieren/löschen; ein Token-Wechsel widerruft den Sync-Zugriff.</li>
        </ul>
        <p class="small text-secondary">Verantwortlich im Sinne des Datenschutzrechts ist der oben genannte Betreiber. Bei Fragen: ${IMPRINT.email}.</p>`,
      en: `
        <h6 class="fw-bold">Imprint</h6>
        <p>Information pursuant to § 5 DDG (German Digital Services Act):</p>
        <p>${IMPRINT.operator}<br>${IMPRINT.street}<br>${IMPRINT.city}<br>${IMPRINT.country}</p>
        <p><strong>Contact:</strong> <a href="mailto:${IMPRINT.email}">${IMPRINT.email}</a></p>
        <hr>
        <h6 class="fw-bold">Privacy policy</h6>
        <p>GoneCycling Web is a client-side application. Your planning data (trips, tours, settings) stays <strong>locally in your browser</strong> (localStorage); it is not transmitted to us.</p>
        <ul>
          <li><strong>No accounts, no tracking:</strong> no sign-in, no analytics/advertising cookies, no profiling.</li>
          <li><strong>Direct service calls:</strong> map tiles, address/POI search (Nominatim/OpenStreetMap) and routing (OSRM/OpenRouteService/BRouter) are fetched <strong>directly by your browser</strong> from the respective providers. This necessarily transmits your IP address and the requested coordinates/search terms to those services; their privacy policies apply.</li>
          <li><strong>Optional sync:</strong> only if you actively use "Connect" is <strong>end-to-end encrypted</strong> data sent to the sync server. It only stores ciphertext under a token hash and cannot read the contents.</li>
          <li><strong>Location:</strong> geolocation is used only with your permission and only locally to centre the map.</li>
          <li><strong>Your control:</strong> you can export/delete local data at any time; rotating the token revokes sync access.</li>
        </ul>
        <p class="small text-secondary">The operator named above is responsible under data protection law. Questions: ${IMPRINT.email}.</p>`,
    },
  },
];

/** Builds sidebar pills + tab content for the current language (Bootstrap pills). */
export function renderHelp(lang) {
  const L = lang === "en" ? "en" : "de";
  const nav = HELP.map(
    (s, i) =>
      `<button class="nav-link text-start${i === 0 ? " active" : ""}" data-bs-toggle="pill" data-bs-target="#help-sec-${s.id}" type="button" role="tab">${s.title[L] || s.title.de}</button>`,
  ).join("");
  const panes = HELP.map(
    (s, i) =>
      `<div class="tab-pane fade${i === 0 ? " show active" : ""}" id="help-sec-${s.id}" role="tabpanel">${s.body[L] || s.body.de}</div>`,
  ).join("");
  return `<div class="d-md-flex gap-3 help-wrap">
      <div class="nav nav-pills flex-md-column help-nav mb-3 mb-md-0" role="tablist">${nav}</div>
      <div class="tab-content help-content flex-grow-1">${panes}</div>
    </div>`;
}
