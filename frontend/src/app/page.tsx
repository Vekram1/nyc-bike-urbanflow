import KPIPanel from "../components/KPIPanel";
import Legend from "../components/Legend";
import MapView from "../components/MapView";
import OptimizationPanel from "../components/OptimizationPanel";
import ReplayScrubber from "../components/ReplayScrubber";
import StationDrawer from "../components/StationDrawer";
import StationLayer from "../components/StationLayer";

export default function HomePage() {
  return (
    <main>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>UrbanFlow Twin</h1>
          <p style={{ margin: "6px 0 0", color: "var(--color-ink-muted)" }}>
            Manhattan Citi Bike replay + counterfactual planning console
          </p>
        </div>
        <Legend />
      </header>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: "20px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <MapView />
          <ReplayScrubber />
          <OptimizationPanel />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <KPIPanel />
          <StationDrawer />
          <StationLayer />
        </div>
      </section>
    </main>
  );
}
