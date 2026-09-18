import { Link, Navigate, Route, Routes } from "react-router-dom";
import Farmer from "./pages/Farmer";
import Exporter from "./pages/Exporter";
import Verify from "./pages/Verify";
import Regulator from "./pages/Regulator";
import WalletBar from "./components/WalletBar";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/farmer" className="brand">
          ZKanopy
        </Link>
        <nav>
          <Link to="/farmer">Farmer</Link>
          <Link to="/exporter">Exporter</Link>
          <Link to="/regulator">Regulator</Link>
        </nav>
        <WalletBar />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/farmer" replace />} />
          <Route path="/farmer" element={<Farmer />} />
          <Route path="/exporter" element={<Exporter />} />
          <Route path="/verify/:id" element={<Verify />} />
          <Route path="/regulator" element={<Regulator />} />
          <Route path="*" element={<p className="card">Not found.</p>} />
        </Routes>
      </main>
      <footer className="foot">
        Base Sepolia testnet · proofs are generated in your browser · coordinates never leave this device
      </footer>
    </div>
  );
}
