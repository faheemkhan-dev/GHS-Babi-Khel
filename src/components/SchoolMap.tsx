/**
 * SchoolMap — interactive Leaflet map, no iframe, no API key.
 * Uses react-leaflet with Esri World Imagery (satellite, default view +
 * labels overlay), OpenStreetMap tiles (street), and OpenTopoMap (terrain).
 * Supports zoom, pan, layer toggle.
 */
import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, LayersControl, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icon broken by bundlers
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

interface RecenterProps {
  lat: number;
  lng: number;
}

// Re-centers map when coordinates change
function Recenter({ lat, lng }: RecenterProps) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

interface SchoolMapProps {
  lat: number;
  lng: number;
  label?: string;
  height?: number;
  zoom?: number;
}

export default function SchoolMap({
  lat,
  lng,
  label = "School Location",
  height = 320,
  zoom = 16,
}: SchoolMapProps) {
  return (
    <div style={{ height, width: "100%", borderRadius: "0.75rem", overflow: "hidden" }}>
      <MapContainer
        center={[lat, lng]}
        zoom={zoom}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
        attributionControl={false}
      >
        <Recenter lat={lat} lng={lng} />

        <LayersControl position="topright">
          {/* Street map */}
          <LayersControl.BaseLayer name="Street">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>

          {/* Satellite — Esri World Imagery, free, no key. Default view. */}
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer
              attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxNativeZoom={19}
            />
          </LayersControl.BaseLayer>

          {/* Satellite w/ labels overlay — road names, place names on top of imagery */}
          <LayersControl.Overlay checked name="Labels">
            <TileLayer
              attribution="Labels &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              maxNativeZoom={19}
            />
          </LayersControl.Overlay>

          {/* Topo */}
          <LayersControl.BaseLayer name="Terrain">
            <TileLayer
              attribution='Map data: &copy; <a href="https://www.opentopomap.org">OpenTopoMap</a>'
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        <Marker position={[lat, lng]}>
          <Popup>{label}</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}
