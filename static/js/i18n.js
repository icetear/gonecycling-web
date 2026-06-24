// Lightweight translation (German ⇄ English). The GERMAN text is the key —
// `t("Reisen")` returns „Reisen" (de) or „Trips" (en); if a translation is
// missing, the German text stays (graceful fallback).
//
// Language: remembered choice (localStorage), otherwise browser language
// (en → English, everything else → German).

const LANG_KEY = "gc.lang";

/** English translations, key = original German text. */
const EN = {
  // — Navbar / scaffolding —
  "Ort oder POI suchen …": "Search place or POI …",
  Suchen: "Search",
  Leeren: "Clear",
  Reisen: "Trips",
  Touren: "Tours",
  Einstellungen: "Settings",
  "nicht verbunden mit GoneCycling App": "not connected to GoneCycling app",
  Verbinden: "Connect",
  Verbunden: "Connected",
  Trennen: "Disconnect",
  Karte: "Map",
  "Kartenansicht wählen": "Choose map view",
  Hilfe: "Help",
  "Hilfe & Info": "Help & info",

  // — Trips/tours lists (offcanvas) —
  Reise: "Trip",
  Tour: "Tour",
  // — Trip-planning mode indicator (pill on the map) —
  Reiseplanung: "Trip planning",
  "Reiseplanung beenden": "Exit trip planning",
  "Reise-Panel öffnen": "Open trip panel",
  "+ Neue Reise": "+ New trip",
  "GPX importieren": "Import GPX",
  Schließen: "Close",
  "Noch keine Reisen.": "No trips yet.",
  "Noch keine Touren. Importiere eine GPX-Datei oder generiere einen Rundkurs.":
    "No tours yet. Import a GPX file or generate a loop.",
  "Rundkurs erzeugen": "Create loop",
  Rundkurs: "Loop",

  // — Settings (modal) —
  "‹ Zurück": "‹ Back",
  Routing: "Routing",
  "Anbieter (OSRM/ORS/BRouter), Server & Profile": "Provider (OSRM/ORS/BRouter), server & profiles",
  "Karten-Schnellziele": "Map quick targets",
  "Etappen-Ziele": "Stage targets",
  "Sicherung & Übertragung": "Backup & transfer",
  "Web-App / Companion": "Web app / companion",
  Anbieter: "Provider",
  "OSRM-Server-URL": "OSRM server URL",
  Profil: "Profile",
  "ORS-Server-URL": "ORS server URL",
  Authentifizierung: "Authentication",
  "API-Schlüssel": "API key",
  "Benutzer/Passwort (Basic-Auth)": "Username/password (basic auth)",
  Benutzername: "Username",
  Passwort: "Password",
  "BRouter-Server-URL": "BRouter server URL",
  "Routing speichern": "Save routing",
  "🏔 Höhendaten laden (für Höhenprofil & Höhenmeter)": "🏔 Load elevation data (for elevation profile & gain)",
  "Höhen-Dienst (URL)": "Elevation service (URL)",
  "OSRM liefert keine Höhe; ORS/BRouter schon. Bei OSRM lädt dieser Dienst die Höhen nach.":
    "OSRM provides no elevation; ORS/BRouter do. For OSRM, this service fetches the elevations.",
  "Alles exportieren": "Export everything",
  "Backup importieren": "Import backup",

  // — Common actions/labels (also used dynamically in planner.js) —
  Start: "Start",
  Ziel: "Destination",
  Wegpunkt: "Waypoint",
  Wegpunkte: "Waypoints",
  Speichern: "Save",
  Abbrechen: "Cancel",
  Entfernen: "Remove",
  Löschen: "Delete",
  Zentrieren: "Center",
  "Auf Karte zentrieren": "Center on map",
  "GPX exportieren": "Export GPX",
  "Tour löschen": "Delete tour",
  "Reise löschen": "Delete trip",
  Distanz: "Distance",
  Höhenmeter: "Elevation gain",
  Punkte: "Points",
  Notizen: "Notes",
  Bewertung: "Rating",
  Transportmittel: "Mode of transport",
  "In Karten öffnen": "Open in maps",
  "🔍 Hier suchen": "🔍 Search here",
  "Als Start setzen": "Set as start",
  "Als Ziel setzen": "Set as destination",
  "Als Etappenziel": "As stage destination",
  "Kein Etappenstart bestimmbar (Start-Unterkunft/Startpunkt setzen).": "No stage start determinable (set start accommodation/start point).",
  "Als Wegpunkt setzen": "Set as waypoint",
  "Als Zwischenstopp": "As intermediate stop",
  "Zwischenstopp": "Intermediate stop",
  "Zwischenstopp entfernen?": "Remove intermediate stop?",
  "Kein Etappenstart/-ziel bestimmbar.": "Cannot determine stage start/destination.",
  "Als Ziel festlegen": "Set as destination",
  "Als Wegpunkt anhängen": "Append as waypoint",
  "🎯 Als Ziel festlegen": "🎯 Set as destination",
  "+ Neue Tour (Start hier)": "+ New tour (start here)",
  "➕ Hier Wegpunkt einfügen": "➕ Insert waypoint here",
  "✏️ Tour bearbeiten": "✏️ Edit tour",
  "↶ Rückgängig": "↶ Undo",
  "↺ Original": "↺ Original",
  "Nächste Etappe": "Next stage",
  Ort: "Place",
  Adresse: "Address",
  Entfernung: "Distance",
  Koordinaten: "Coordinates",

  // — Tour detail / map popups (dynamic in planner.js) —
  Tourname: "Tour name",
  "Tags (mit Komma getrennt)": "Tags (comma-separated)",
  "z. B. Familie, Pendeln": "e.g. family, commute",
  Notiz: "Note",
  "✏️ Die Route ist direkt auf der Karte bearbeitbar: Knoten ziehen zum Verschieben, auf die Linie klicken zum Einfügen, leere Stelle klicken zum Anhängen.":
    "✏️ The route is editable directly on the map: drag a node to move, click the line to insert a waypoint, click an empty spot to append.",
  "Ort wird ermittelt …": "Resolving place …",
  "Schnellziele in der Nähe": "Quick targets nearby",
  "Noch keine Wegpunkte. Auf die Karte klicken zum Anhängen.": "No waypoints yet. Click the map to append.",
  "ab Vorgänger": "from previous",
  "ab Vorgänger · Luftlinie (Override)": "from previous · straight line (override)",
  "Route wird berechnet …": "Computing route …",
  Loop: "Loop",
  "Auf die Karte zentrieren": "Center on map",
  "Tour-Wegpunkt": "Tour waypoint",
  Zwischenpunkt: "Intermediate point",
  geplant: "planned",
  Gesamtdistanz: "Total distance",
  Rückgängig: "Undo",
  Original: "Original",
  Streckenpunkte: "Track points",
  Etappen: "Stages",
  Tage: "Days",
  Anstieg: "Ascent",
  Fahrzeit: "Ride time",
  "🗓 Tagesübersicht": "🗓 Itinerary",
  Tagesübersicht: "Itinerary",
  Tag: "Day",
  Datum: "Date",
  Nächte: "Nights",
  "Drucken / als PDF speichern": "Print / save as PDF",
  Kosten: "Cost",
  "Keine Treffer.": "No results.",
  "Suche …": "Searching …",
  "Versorgung": "Supplies",
  "Versorgung entlang der Route": "Supplies along the route",
  "Sonnenuntergang am Ziel": "Sunset at destination",
  gefunden: "found",
  "Versorgungs-Dienst nicht erreichbar.": "Supply service unavailable.",
  "Zuletzt gesucht": "Recently searched",
  "Status ändern": "Change status",
  "Routenvorschau": "Route preview",
  "Hier Wegpunkt einfügen": "Insert waypoint here",
  "Tour bearbeiten": "Edit tour",

  // — Trip detail (renderDetail + helpers) —
  Reisetitel: "Trip title",
  "Auswahl aufheben – neu auf der Karte planen": "Clear selection – plan anew on the map",
  "Geplanter Start": "Planned start",
  Ende: "End",
  "Ort suchen …": "Search place …",
  "auf Karte setzen …": "set on map …",
  "Auf Karte setzen": "Set on map",
  "+ Zwischenziel auf Karte": "+ Waypoint on map",
  "Aktuellen Standort als Start setzen": "Set current location as start",
  "📍 Mein Standort": "📍 My location",
  "Start/Ziel und Reihenfolge umkehren": "Reverse start/destination and order",
  "⇅ Umkehren": "⇅ Reverse",
  "Alle Wegpunkte entfernen": "Remove all waypoints",
  "🗑 Leeren": "🗑 Clear",
  "Start-Unterkunft": "Start accommodation",
  "Als Start-Unterkunft": "As start accommodation",
  "Vorlage (Tour)": "Template (tour)",
  "Vorlage auf der Karte anzeigen": "Show template on the map",
  "— keine —": "— none —",
  "▶ Reise starten": "▶ Start trip",
  "Noch keine Etappen.": "No stages yet.",
  "Nur für Auto-Etappen oder Planung ohne Vorlage nötig.": "Only needed for auto stages or planning without a template.",
  "+ Etappe": "+ Stage",
  "🧭 Nächste Etappe": "🧭 Next stage",
  "Auto-Etappen": "Auto stages",
  Reiseteilnehmer: "Travellers",
  "+ Teilnehmer": "+ Traveller",
  "Alle Ausgaben werden {name} zugeordnet.": "All expenses are assigned to {name}.",
  "Ausgaben & Kosten": "Expenses & costs",
  "Noch keine Ausgaben.": "No expenses yet.",
  "+ Ausgabe": "+ Expense",
  Unterkünfte: "Accommodation",
  Ausgaben: "Expenses",
  Gesamtkosten: "Total cost",
  "Notizen zur Reise": "Trip notes",
  "Reise löschen": "Delete trip",
  "Position entfernen": "Remove position",
  "Unterkunft suchen …": "Search accommodation …",
  "Nächte am Start": "Nights at start",
  "Unterkunft (Name)": "Accommodation (name)",
  "Preis (gesamt)": "Price (total)",
  gebucht: "booked",
  "Route neu berechnen": "Recompute route",
  "Route entfernen": "Remove route",
  "Route berechnen": "Compute route",
  "Route anzeigen": "Show route",
  Rest: "Remaining",
  Abschnitt: "Section",
  "Wie soll dieser Abschnitt geführt werden?": "How should this section be routed?",
  "Vorlage folgen": "Follow template",
  Direkt: "Direct",
  "Abschnitts-Marker auf der Karte (Etappe wählen): 🧭 Vorlage · 📏 direkt.": "Section markers on the map (select the stage): 🧭 template · 📏 direct.",
  "Streckenführung": "Routing",
  "Vorlage folgen ⇄ direkt (kürzeste Route)": "Follow template ⇄ direct (shortest route)",
  "Restdistanz bis Reiseende": "Remaining distance to end of trip",
  "Diesen Wegpunkt entfernen?": "Remove this waypoint?",
  "Dieses Zwischenziel entfernen?": "Remove this waypoint?",
  "Route dieser Etappe entfernen?": "Remove this stage’s route?",
  "Diese Etappe entfernen?": "Remove this stage?",
  "Teilnehmer entfernen?": "Remove traveller?",
  "Ausgabe entfernen?": "Remove expense?",
  "Position entfernen?": "Remove position?",
  "Wegpunkt entfernen?": "Remove waypoint?",
  Unterkunft: "Accommodation",
  "Unterkunft hinzufügen": "Add accommodation",
  "Im Menü öffnen": "Open in menu",
  "Route auf der Karte anzeigen": "Show route on the map",
  "Diese Etappe hat noch keine berechnete Route.": "This stage does not have a computed route yet.",
  "aus Start – Ziel": "from start – destination",
  "Etappe als Start – Ziel benennen": "Name the stage as start – destination",
  "— oder vorhandene Tour wählen —": "— or choose an existing tour —",
  Etappe: "Stage",
  Geplant: "Planned",
  Aktiv: "Active",
  Abgeschlossen: "Completed",
  Preis: "Price",
  "Unterkunft-Notiz": "Accommodation note",
  "Etappen-Notiz": "Stage note",
  Titel: "Title",
  Betrag: "Amount",
  "— keiner —": "— none —",
  "Wähle eine Tour als": "Choose a tour as the",
  "rote Vorlage": "red template",
  // — Guided planner ("Next stage") —
  "Gib eine Wunschdistanz an — rundum werden Ziele (deine Etappen-Ziele wie Hotel/Bahnhof/Ferienwohnung, Pflicht-Stopps und Orte) bei ~dieser Distanz gesucht. Auswahl legt die Etappe an und rückt den Startpunkt weiter.":
    "Enter a desired distance — targets around it (your stage targets like hotel/station/holiday flat, mandatory stops and places) are searched at ~this distance. Choosing one creates the stage and advances the start point.",
  Wunschdistanz: "Desired distance",
  "Ziele suchen": "Search targets",
  "Nächste Etappe ab": "Next stage from",
  "Kein Startpunkt — setze zuerst einen Reisestart.": "No start point — set a trip start first.",
  "Ziele um": "targets around",
  "Keine Ziele gefunden — andere Distanz testen oder Etappen-Ziele in den Einstellungen pflegen.":
    "No targets found — try another distance or manage stage targets in settings.",
  "Suche Ziele …": "Searching targets …",
  "Routing fehlgeschlagen.": "Routing failed.",
  Stopp: "Stop",
  "Pflicht-Stopp": "Mandatory stop",
  // — "Next stage": deviation from the template + largest cities —
  "zur Vorlage": "to template",
  "Größte Städte in der Nähe": "Largest cities nearby",
  "Städte werden gesucht …": "Searching cities …",
  "Keine Städte mit Einwohnerzahl gefunden.": "No cities with population found.",
  "Städte-Dienst nicht erreichbar.": "City service unavailable.",
  Stadt: "City",
  Einwohner: "inhabitants",
  '„Auto-Etappen" teilt dann diese Strecke (auf Start/Ziel zugeschnitten, falls gesetzt).':
    '"Auto stages" then splits this route (trimmed to start/destination if set).',

  // — Settings / modals (static) —
  "‹ Zurück": "‹ Back",
  "🧭 Routing": "🧭 Routing",
  "🚩 Karten-Schnellziele": "🚩 Map quick targets",
  "POIs beim Tippen auf die Karte (Café, Supermarkt …)": "POIs when tapping the map (café, supermarket …)",
  "🏁 Etappen-Ziele": "🏁 Stage targets",
  'Snap-Punkte für „Nächste Etappe" (Hotel, Bahnhof …)': 'Snap points for "Next stage" (hotel, station …)',
  "💾 Sicherung & Übertragung": "💾 Backup & transfer",
  "Alles exportieren / Backup importieren": "Export everything / import backup",
  "🔗 Verbindung (Companion)": "🔗 Connection (companion)",
  "Sync mit der GoneCycling-App per Token": "Sync with the GoneCycling app via token",
  Anbieter: "Provider",
  Profil: "Profile",
  'Der öffentliche Demo-Server unterstützt nur „driving".': 'The public demo server only supports "driving".',
  "Beim Tippen auf die Karte als Schnell-Buttons verfügbar (Suche rund um den Punkt). Schalter = aktiv. Der Suchbegriff dient zugleich als Beschriftung. Wird automatisch gespeichert.":
    "Available as quick buttons when tapping the map (search around the point). Toggle = active. The search term also serves as the label. Saved automatically.",
  "+ POI": "+ POI",
  'Snap-Punkte für „Nächste Etappe": um die Wunschdistanz herum werden diese aktiven Ziele gesucht (z. B. Hotel, Bahnhof, Ferienwohnung). Wird automatisch gespeichert.':
    'Snap points for "Next stage": these active targets are searched around the desired distance (e.g. hotel, station, holiday flat). Saved automatically.',
  "+ Etappen-Ziel": "+ Stage target",
  'Exportiert alle Reisen, Touren und Einstellungen in eine Datei. Reisen & Touren werden zusätzlich verschlüsselt mit der iPhone-App gesynct (Token unter „Verbindung").':
    'Exports all trips, tours and settings to a file. Trips & tours are additionally synced encrypted with the iPhone app (token under "Connection").',
  "Etappen automatisch erzeugen": "Generate stages automatically",
  "Die Strecke Start → (Stopps) → Ziel wird geroutet und aufgeteilt.": "The route start → (stops) → destination is routed and split.",
  "nach Distanz": "by distance",
  "km pro Etappe": "km per stage",
  "nach Anzahl": "by count",
  Generieren: "Generate",
  "Rundkurs generieren": "Generate loop",
  "Der Rundkurs startet an der aktuellen Kartenmitte. Verschiebe die Karte zum Startpunkt, bevor du generierst.":
    "The loop starts at the current map center. Move the map to the start point before generating.",
  "km (ungefähr)": "km (approx.)",
  "Mit GoneCycling App verbinden": "Connect to GoneCycling app",
  "Gib den Token deiner GoneCycling-App ein – oder generiere einen neuen. Deine Reisen/Routen werden Ende-zu-Ende verschlüsselt; der Server kann sie nicht lesen.":
    "Enter your GoneCycling app token – or generate a new one. Your trips/routes are end-to-end encrypted; the server cannot read them.",
  Token: "Token",
  "Token …": "Token …",
  "Bewahre den Token wie ein Passwort auf.": "Keep the token like a password.",
  "Neu generieren": "Regenerate",
  "📱 Mit iPhone koppeln": "📱 Pair with iPhone",
  "Mit iPhone koppeln": "Pair with iPhone",
  "Scanne diesen Code mit der GoneCycling-App auf dem iPhone – oder gib den Token dort manuell ein.":
    "Scan this code with the GoneCycling app on your iPhone – or enter the token there manually.",
  "Token kopieren": "Copy token",
  "Behandle den Code wie ein Passwort – wer ihn hat, sieht deine Reisen.":
    "Treat the code like a password – anyone who has it can see your trips.",
  "Kopiert!": "Copied!",

  // — User accounts ("upgrade": profile/login/logout) —
  Anmelden: "Log in",
  Abmelden: "Log out",
  Registrieren: "Register",
  "Menü": "Menu",
  "Profil anlegen": "Create profile",
  "Profil erstellen": "Create profile",
  Vorname: "First name",
  Nachname: "Last name",
  "E-Mail": "Email",
  "Passwort bestätigen": "Confirm password",
  "Mein Profil": "My profile",
  "Profil löschen": "Delete profile",
  "Profil wirklich unwiderruflich löschen? Dein Konto (Name, E-Mail, Passwort) wird entfernt und du wirst abgemeldet. Bereits synchronisierte Reisen bleiben erhalten.":
    "Really delete your profile permanently? Your account (name, email, password) is removed and you are signed out. Trips already synced stay intact.",
  "Profil konnte nicht gelöscht werden.": "Could not delete profile.",
  "Bestätigungsmail erneut senden": "Resend confirmation email",
  "Lege ein Profil an, um dich künftig per E-Mail und Passwort anzumelden — auch auf einem neuen Gerät. Wir senden dir eine Bestätigungsmail.":
    "Create a profile to sign in with email and password from now on — even on a new device. We'll send you a confirmation email.",
  "Melde dich mit E-Mail und Passwort an.": "Sign in with your email and password.",
  "Bitte alle Felder ausfüllen.": "Please fill in all fields.",
  "Die Passwörter stimmen nicht überein.": "The passwords do not match.",
  "Bestätigungsmail gesendet — bitte prüfe dein Postfach.": "Confirmation email sent — please check your inbox.",
  "Registrierung fehlgeschlagen:": "Registration failed:",
  "Bestätigungsmail erneut gesendet.": "Confirmation email resent.",
  "Falls dein Profil noch nicht bestätigt ist, wurde die Bestätigungsmail erneut gesendet.":
    "If your profile isn't confirmed yet, the confirmation email has been resent.",
  "Passwort vergessen?": "Forgot password?",
  "Passwort zurücksetzen": "Reset password",
  "Link senden": "Send link",
  "Wir senden dir einen Link zum Zurücksetzen, falls ein Konto mit dieser E-Mail existiert.":
    "We'll send you a reset link if an account with this email exists.",
  "Falls ein Konto existiert, wurde ein Link gesendet.": "If an account exists, a link has been sent.",
  "Passwort ändern": "Change password",
  "Aktuelles Passwort": "Current password",
  "Neues Passwort": "New password",
  "Passwort geändert.": "Password changed.",
  "Passwort-Änderung fehlgeschlagen:": "Password change failed:",
  // — Upgrade explanation (token/sync ↔ profile) —
  "Auf Profil upgraden?": "Upgrade to a profile?",
  "Beim Upgrade auf ein Profil werden deine Benutzerdaten (Name, E-Mail) und der Schlüssel zum Entschlüsseln deiner Reisen auf dem Server gespeichert. Die anonyme zero-knowledge-Nutzung wird damit für dein Konto aufgegeben.":
    "Upgrading to a profile stores your user data (name, email) and the key to decrypt your trips on the server. The anonymous zero-knowledge usage is thereby given up for your account.",
  "🔑 Ohne Profil: Token / Sync (anonym)": "🔑 Without a profile: token / sync (anonymous)",
  "Kein Konto, keine E-Mail, kein Passwort.": "No account, no email, no password.",
  "Der Server speichert nur verschlüsselte Daten – er kann deine Reisen nicht lesen.":
    "The server stores only encrypted data – it cannot read your trips.",
  "Keine persönlichen Daten gespeichert.": "No personal data stored.",
  "Zugang nur über den geheimen Token – verloren = Daten weg.": "Access only via the secret token – lost = data gone.",
  "Gerätewechsel: Token selbst übertragen.": "Switching devices: transfer the token yourself.",
  "👤 Mit Profil (Upgrade)": "👤 With profile (upgrade)",
  "Anmeldung mit E-Mail und Passwort auf jedem Gerät.": "Sign in with email and password on any device.",
  "Passwort vergessen? Zurücksetzen per E-Mail.": "Forgot password? Reset via email.",
  "Name und E-Mail werden auf dem Server gespeichert.": "Name and email are stored on the server.",
  "Der Schlüssel zum Entschlüsseln liegt zur Wiederherstellung auf dem Server.":
    "The decryption key is kept on the server for recovery.",
  "Keine anonyme zero-knowledge-Nutzung mehr für dein Konto.": "No more anonymous zero-knowledge usage for your account.",
  "Verstanden, weiter": "Understood, continue",

  // — Messages (alert/confirm) + remaining labels —
  "GPX-Import fehlgeschlagen:": "GPX import failed:",
  "Ungespeicherte Änderungen an der Tour verwerfen?": "Discard unsaved changes to the tour?",
  "Diese Tour löschen?": "Delete this tour?",
  "Keine Streckenpunkte zum Exportieren.": "No track points to export.",
  "Keine Streckenpunkte in der GPX-Datei gefunden.": "No track points found in the GPX file.",
  "Alle Wegpunkte (Start, Ziel, Zwischenziele) entfernen?": "Remove all waypoints (start, destination, intermediate)?",
  "Fehler:": "Error:",
  "Diese Reise wirklich löschen?": "Really delete this trip?",
  "Start/Ziel der Etappe nicht auflösbar. Benenne die Etappe als Start – Ziel.":
    "Cannot resolve the stage's start/destination. Name the stage as start – destination.",
  "Tour auf den Originalstand zurücksetzen? Ungespeicherte und gespeicherte Änderungen dieser Sitzung gehen verloren.":
    "Reset the tour to its original state? Unsaved and saved changes from this session will be lost.",
  "Keine Etappen-Routen zum Exportieren vorhanden.": "No stage routes available to export.",
  "Standortbestimmung wird vom Browser nicht unterstützt.": "Geolocation is not supported by the browser.",
  "Standort konnte nicht ermittelt werden.": "Could not determine your location.",
  Zwischenziel: "Waypoint",
  'Zwischenziel {n} von {total}': "Waypoint {n} of {total}",
  'Tippe auf die Karte, um „{label}" zu setzen … (Esc bricht ab)': 'Tap the map to set "{label}" … (Esc cancels)',
  "Unterkunft · {label}": "Accommodation · {label}",
  Etappe: "Stage",
  "Verbindung fehlgeschlagen:": "Connection failed:",
  "Bitte Token eingeben oder generieren.": "Please enter or generate a token.",
  "Exportiert: {trips} Reisen, {rides} Touren/Routen.": "Exported: {trips} trips, {rides} tours/routes.",
  "Bestehende Reisen/Touren ZUERST löschen und vollständig ersetzen?\n\nOK = ersetzen · Abbrechen = zusammenführen":
    "Delete existing trips/tours FIRST and replace completely?\n\nOK = replace · Cancel = merge",
  "Importiert: {trips} Reisen, {rides} Touren/Routen.": "Imported: {trips} trips, {rides} tours/routes.",
  "Import fehlgeschlagen:": "Import failed:",
  "Nach oben": "Move up",
  "Nach unten": "Move down",
  "Treffer ausblenden": "Hide results",
  "POIs hier:": "POIs here:",
  "+Stopp": "+Stop",
  "Fahrrad": "Bicycle",
  "Zu Fuß": "On foot",
  "Auto": "Car",
  "Motorrad": "Motorcycle",
  "Berechne …": "Computing …",
  "Als Start": "As start",
  "Als Ziel": "As destination",
  "Auf der Karte zeigen": "Show on map",
  "Als Zwischenziel": "As waypoint",
  "Bestehende Reisen/Touren ZUERST löschen und vollständig ersetzen?\n\nOK = ersetzen · Abbrechen = zusammenführen":
    "Delete existing trips/tours FIRST and fully replace?\n\nOK = replace · Cancel = merge",
  "Ziehen, um hier einen Zwischenpunkt einzufügen": "Drag to insert an intermediate point here",
  "Ziehen, um hier einen Zwischenstopp einzufügen": "Drag to insert a stop here",
  "Direkte Verbindung (Luftlinie) zum Vorgänger erzwingen – wenn das Routing den bekannten Weg nicht nimmt": "Force a direct (straight-line) connection to the previous point – when routing won't take the known path",
  "Aktiv / berücksichtigen": "Active / included",
  "Suchbegriff": "Search term",
  "CyclOSM (Rad)": "CyclOSM (cycling)",
  "Humanitär (HOT)": "Humanitarian (HOT)",
  "Satellit (Esri)": "Satellite (Esri)",
  "Hell (CARTO)": "Light (CARTO)",
  "Dunkel (CARTO)": "Dark (CARTO)",
  "Bitte eine Distanz angeben.": "Please enter a distance.",
  "Neue Tour": "New tour",
  "Importierte Route": "Imported route",
  "Keine Reise gewählt.": "No trip selected.",
  "Start und Ziel (oder eine Vorlage) nötig.": "Start and destination (or a template) required.",
  "{n} Etappen erzeugt.": "{n} stages created.",
  "Karten-Schnellziele": "Map quick targets",
  "Etappen-Ziele": "Stage targets",
  "Sicherung & Übertragung": "Backup & transfer",

  // — Theme / language —
  Sprache: "Language",
  Erscheinungsbild: "Appearance",
  Hell: "Light",
  Dunkel: "Dark",
  Automatisch: "Auto",
  Deutsch: "German",
  Englisch: "English",
};

let lang = detectLang();

function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "de" || saved === "en") return saved;
  } catch {
    /* localStorage may be blocked */
  }
  // navigator is not guaranteed to exist in SSR/Node → query defensively.
  const navLang = typeof navigator !== "undefined" && navigator.language;
  return (navLang || "de").toLowerCase().startsWith("en") ? "en" : "de";
}

/** Current language ("de" | "en"). */
export function getLang() {
  return lang;
}

/** Set + remember the language. */
export function setLang(l) {
  lang = l === "en" ? "en" : "de";
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
}

/** Translates a German text (or returns it unchanged). */
export function t(de) {
  if (lang !== "en") return de;
  return Object.prototype.hasOwnProperty.call(EN, de) ? EN[de] : de;
}

// --- POI categories (map quick targets + stage targets) ---------------------
// The known default categories serve as both the display label AND the
// Nominatim search term. So an EN UI shows „Bakery" instead of „Bäckerei" (and
// searches for it too), we translate these *presets* bidirectionally. Custom,
// freely typed terms are NOT a preset → stay unchanged (verbatim).
// Key = German canonical form, value = English equivalent (Nominatim-compatible).
const POI_PRESETS = {
  Café: "Café",
  Supermarkt: "Supermarket",
  Tankstelle: "Gas station",
  Restaurant: "Restaurant",
  Bäckerei: "Bakery",
  Apotheke: "Pharmacy",
  Fahrradladen: "Bicycle shop",
  Campingplatz: "Campsite",
  Hotel: "Hotel",
  Bahnhof: "Train station",
  Ferienwohnung: "Holiday apartment",
  Pension: "Guest house",
  Jugendherberge: "Youth hostel",
};
// Reverse (English lowercase → German canonical form), so poiLabel recognises a
// term already stored in English and translates it back correctly.
const POI_PRESETS_REV = {};
for (const [de, en] of Object.entries(POI_PRESETS)) POI_PRESETS_REV[en.toLowerCase()] = de;

/**
 * Returns the category label/search term in the current language. Recognises
 * presets in BOTH languages; unknown (custom) terms stay unchanged. Example:
 * poiLabel("Bäckerei") → "Bakery" (en) / "Bäckerei" (de);
 * poiLabel("Eisdiele") → "Eisdiele" (no preset).
 */
export function poiLabel(term) {
  if (!term) return term;
  let de = null;
  if (Object.prototype.hasOwnProperty.call(POI_PRESETS, term)) de = term;
  else {
    const rev = POI_PRESETS_REV[String(term).toLowerCase()];
    if (rev) de = rev;
  }
  if (!de) return term; // custom term → verbatim
  return lang === "en" ? POI_PRESETS[de] : de;
}
