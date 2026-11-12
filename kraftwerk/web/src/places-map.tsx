import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Places on an OpenStreetMap map (Leaflet, OSM's own tiles): a dot per place
 * with coordinates, the selected one larger and in the accent colour. With
 * one selected the map flies to it; without, it fits all of them. A dot is
 * a button: clicking it calls `onPick` with the place's slug.
 */
export interface MapPlace {
  slug: string;
  title: string;
  lat: number;
  lng: number;
}

export function PlacesMap({ places, selected, onPick }: { places: MapPlace[]; selected?: string; onPick: (slug: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([46.8, 8.2], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // The column is resized by dragging its divider: the map follows.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  const key = places.map((p) => `${p.slug}@${p.lat},${p.lng}`).join("|");
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#2563eb";
    for (const p of places) {
      const on = p.slug === selected;
      L.circleMarker([p.lat, p.lng], { radius: on ? 10 : 7, weight: 2, color: "#fff", fillColor: on ? accent : "#be123c", fillOpacity: 1 })
        .bindTooltip(p.title, { direction: "top", offset: [0, -8], permanent: on })
        .on("click", () => pick.current(p.slug))
        .addTo(g)
        .getElement()
        ?.setAttribute("data-place", p.slug);
    }
    const sel = places.find((p) => p.slug === selected);
    if (sel) m.flyTo([sel.lat, sel.lng], Math.max(m.getZoom(), 15), { duration: 0.6 });
    else if (places.length === 1) m.setView([places[0].lat, places[0].lng], 14);
    else if (places.length > 1) m.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng] as [number, number])), { padding: [32, 32], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, selected]);

  return <div ref={box} className="places-map size-full min-h-[240px] overflow-hidden rounded-lg border border-line" role="region" aria-label="map of the places" />;
}
