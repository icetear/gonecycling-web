// Freely usable basemaps (no API key) + a layer switcher (MapLibre control,
// bottom left). Swaps the "basemap" raster source and keeps the route/marker
// layers on top. The choice is remembered in localStorage.

import { t } from "gc/i18n";

const STORAGE_KEY = "gc.basemap";

/**
 * Curated, key-free tile providers. `{s}` does not exist in MapLibre —
 * subdomains are given as multiple URLs. Esri uses `{z}/{y}/{x}`.
 * Use all only with attribution (attribution per entry).
 */
export const BASEMAPS = [
  {
    id: "osm",
    label: "OpenStreetMap",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    maxzoom: 19,
    attribution: "© OpenStreetMap contributors",
  },
  {
    id: "cyclosm",
    label: "CyclOSM (Rad)",
    tiles: [
      "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
      "https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
      "https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    ],
    maxzoom: 18,
    attribution: "CyclOSM · © OpenStreetMap contributors",
  },
  {
    id: "opentopo",
    label: "OpenTopoMap",
    tiles: [
      "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
    ],
    maxzoom: 17,
    attribution: "© OpenTopoMap (CC-BY-SA) · © OpenStreetMap contributors",
  },
  {
    id: "hot",
    label: "Humanitär (HOT)",
    tiles: [
      "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    ],
    maxzoom: 19,
    attribution: "Humanitarian OSM Team · © OpenStreetMap contributors",
  },
  {
    id: "osmfr",
    label: "OSM France",
    tiles: [
      "https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
    ],
    maxzoom: 20,
    attribution: "© OpenStreetMap France · © OpenStreetMap contributors",
  },
  {
    id: "esri-sat",
    label: "Satellit (Esri)",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 19,
    attribution: "© Esri, Maxar, Earthstar Geographics",
  },
  {
    id: "carto-light",
    label: "Hell (CARTO)",
    tiles: [
      "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    ],
    maxzoom: 20,
    attribution: "© CARTO · © OpenStreetMap contributors",
  },
  {
    id: "carto-dark",
    label: "Dunkel (CARTO)",
    tiles: [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ],
    maxzoom: 20,
    attribution: "© CARTO · © OpenStreetMap contributors",
  },
];

/** The basemap to use initially (remembered choice or first entry). */
export function initialBasemap() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* localStorage may be blocked */
  }
  return BASEMAPS.find((b) => b.id === saved) || BASEMAPS[0];
}

/** MapLibre style object with the chosen basemap as the lowest raster layer. */
export function basemapStyle(def) {
  return {
    version: 8,
    sources: {
      basemap: { type: "raster", tiles: def.tiles, tileSize: 256, maxzoom: def.maxzoom || 19, attribution: def.attribution },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

/**
 * Swaps the basemap: remove the "basemap" source/layer and re-insert it below
 * all other layers (routes/markers) so the overlays stay on top. Attribution
 * comes from the source.
 */
export function applyBasemap(map, def) {
  if (map.getLayer("basemap")) map.removeLayer("basemap");
  if (map.getSource("basemap")) map.removeSource("basemap");
  map.addSource("basemap", { type: "raster", tiles: def.tiles, tileSize: 256, maxzoom: def.maxzoom || 19, attribution: def.attribution });
  const firstOverlay = map.getStyle().layers.find((l) => l.id !== "basemap");
  map.addLayer({ id: "basemap", type: "raster", source: "basemap" }, firstOverlay ? firstOverlay.id : undefined);
  try {
    localStorage.setItem(STORAGE_KEY, def.id);
  } catch {
    /* ignore */
  }
}

/** MapLibre IControl: layer icon at the bottom left, opens the basemap picker. */
export class BasemapControl {
  constructor(currentId) {
    this._currentId = currentId;
  }

  onAdd(map) {
    this._map = map;
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group gc-basemap-ctrl";

    const button = document.createElement("button");
    button.type = "button";
    button.title = t("Kartenansicht wählen");
    button.setAttribute("aria-label", t("Kartenansicht wählen"));
    button.className = "gc-basemap-btn";
    button.textContent = "🗺️";

    const panel = document.createElement("div");
    panel.className = "gc-basemap-panel d-none";

    const rebuildPanel = () => {
      panel.innerHTML = "";
      for (const def of BASEMAPS) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "gc-basemap-item" + (def.id === this._currentId ? " active" : "");
        item.textContent = t(def.label);
        item.addEventListener("click", () => {
          this._currentId = def.id;
          applyBasemap(map, def);
          rebuildPanel();
          panel.classList.add("d-none");
        });
        panel.appendChild(item);
      }
    };
    rebuildPanel();

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.toggle("d-none");
    });
    // A click outside closes the panel.
    this._docClick = (e) => {
      if (!container.contains(e.target)) panel.classList.add("d-none");
    };
    document.addEventListener("click", this._docClick);

    container.appendChild(panel);
    container.appendChild(button);
    this._container = container;
    return container;
  }

  onRemove() {
    document.removeEventListener("click", this._docClick);
    this._container?.parentNode?.removeChild(this._container);
    this._map = undefined;
  }
}
