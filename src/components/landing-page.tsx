"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import campus from "../../pic/Panpacific-University-North-Philippines.jpg";
import universityLogo from "../../pic/Panpacific-University.png";
import boxes from "../../pic/boxes.png";
import laptop from "../../pic/laptop.png";
import checklist from "../../pic/checklist.png";
import flower from "../../pic/flower.png";

type Feature = "Inventory" | "Stock Information" | "Supply Updates";
type PublicStock = { id: string; name: string; category: string; unit: string; quantity: number };

function UniversityLogo({ decorative = false }: { decorative?: boolean }) {
  return (
    <span className="university-logo">
      <Image
        src={universityLogo}
        alt={decorative ? "" : "Panpacific University"}
        sizes="420px"
        preload
      />
    </span>
  );
}

function FeatureIcon({ kind }: { kind: Feature }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      {kind === "Inventory" ? (
        <g stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round">
          <path d="m20 4 14 8v17l-14 8-14-8V12Z" />
          <path d="m6 12 14 8 14-8M20 20v17M13 8l14 8" />
        </g>
      ) : kind === "Stock Information" ? (
        <g
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d="M9 4h15l8 8v24H9Z" />
          <path d="M23 4v10h9M15 20h11M15 26h11M15 12h2" />
        </g>
      ) : (
        <g fill="currentColor">
          <rect x="5" y="20" width="7" height="15" rx="2.5" opacity=".7" />
          <rect x="17" y="13" width="7" height="22" rx="2.5" opacity=".85" />
          <rect x="29" y="5" width="7" height="30" rx="2.5" />
        </g>
      )}
    </svg>
  );
}

function SupplyScene() {
  return (
    <div className="supply-scene" aria-hidden="true">
      <Image
        className="scene-asset scene-boxes"
        src={boxes}
        alt=""
        sizes="220px"
        preload
      />
      <Image
        className="scene-asset scene-laptop"
        src={laptop}
        alt=""
        sizes="(max-width: 520px) 350px, 600px"
        preload
      />
      <Image
        className="scene-asset scene-flower"
        src={flower}
        alt=""
        sizes="200px"
        preload
      />
      <Image
        className="scene-asset scene-checklist"
        src={checklist}
        alt=""
        sizes="180px"
        preload
      />
    </div>
  );
}

const features: { title: Feature; description: string }[] = [
  { title: "Inventory", description: "View available supplies." },
  {
    title: "Stock Information",
    description: "Check supply details and availability.",
  },
  { title: "Supply Updates", description: "See the latest stock information." },
];

export default function LandingPage({ stocks }: { stocks: PublicStock[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialogContent, setDialogContent] = useState<Feature | "About">(
    "Inventory",
  );
  const [activeNav, setActiveNav] = useState("Home");
  function openDialog(content: Feature | "About") {
    setDialogContent(content);
    dialogRef.current?.showModal();
  }

  return (
    <div className="site-shell" id="home">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a
            href="#home"
            className="brand-link"
            aria-label="Panpacific University home"
            onClick={() => setActiveNav("Home")}
          >
            <UniversityLogo />
          </a>
          <nav aria-label="Main navigation">
            <a
              className={activeNav === "Home" ? "nav-link active" : "nav-link"}
              aria-current={activeNav === "Home" ? "page" : undefined}
              href="#home"
              onClick={() => setActiveNav("Home")}
            >
              Home
            </a>
            <a
              className={
                activeNav === "Features" ? "nav-link active" : "nav-link"
              }
              href="#features"
              onClick={() => setActiveNav("Features")}
            >
              Features
            </a>
            <button className="nav-link" onClick={() => openDialog("About")}>
              About
            </button>
            <Link className="nav-link" href="/login">Staff sign in</Link>
          </nav>
        </div>
      </header>
      <main id="main-content">
        <section className="hero" aria-labelledby="hero-title">
          <Image
            className="campus-background"
            src={campus}
            alt=""
            fill
            sizes="100vw"
            preload
          />
          <div className="hero-wash" />
          <div className="hero-inner">
            <div className="hero-copy">
              <h1 id="hero-title">
                <span>SupplyHub</span>SUPPLIES MANAGEMENT SYSTEM
              </h1>
              <p>
                Browse selected university supplies and their current stock.
                <br className="wide-break" /> Staff can sign in to view supplies and submit requests.
              </p>
              <Link
                className="stocks-button"
                href="#available-stock"
              >
                View Stocks
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M3 12h17m-6-6 6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            </div>
            <SupplyScene />
          </div>
          <div className="desktop-surface" />
        </section>
        <section
          className="features-section"
          id="features"
          aria-labelledby="features-title"
        >
          <h2 id="features-title">Everything you need in one system</h2>
          <div className="feature-grid">
            {features.map((feature) => (
              <button
                className="feature-card"
                key={feature.title}
                onClick={() => openDialog(feature.title)}
              >
                <span
                  className={
                    feature.title === "Stock Information"
                      ? "feature-icon blue"
                      : "feature-icon green"
                  }
                >
                  <FeatureIcon kind={feature.title} />
                </span>
                <span className="feature-copy">
                  <span className="feature-title">{feature.title}</span>
                  <span className="feature-description">
                    {feature.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="public-stock-section" id="available-stock" aria-labelledby="public-stock-title">
          <div className="public-stock-heading">
            <p className="public-stock-eyebrow">PUBLIC STOCK AVAILABILITY</p>
            <h2 id="public-stock-title">Selected available supplies</h2>
            <p>Current quantities for supplies selected by the Supplies Office.</p>
          </div>
          {stocks.length ? (
            <div className="public-stock-grid">
              {stocks.map((item) => (
                <article className="public-stock-card" key={item.id}>
                  <div><span className="public-stock-category">{item.category}</span><h3>{item.name}</h3></div>
                  <div className="public-stock-quantity"><strong>{new Intl.NumberFormat("en-PH").format(item.quantity)}</strong><span>{item.unit}{item.quantity === 1 ? "" : "s"} available</span></div>
                  <span className={item.quantity > 0 ? "public-stock-status in-stock" : "public-stock-status out-of-stock"}>{item.quantity > 0 ? "In stock" : "Out of stock"}</span>
                </article>
              ))}
            </div>
          ) : <p className="public-stock-empty">No supplies are currently selected for public display.</p>}
        </section>
      </main>
      <footer className="site-footer">
        <p>
          © {new Date().getFullYear()} Panpacific University{" "}
          <span className="footer-divider">|</span> SupplyHub
        </p>
        <span className="footer-watermark" aria-hidden="true">
          <UniversityLogo decorative />
        </span>
      </footer>
      <dialog
        ref={dialogRef}
        className="information-dialog"
        aria-labelledby="dialog-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="dialog-content">
          <button
            className="dialog-close"
            aria-label="Close dialog"
            onClick={() => dialogRef.current?.close()}
          >
            ×
          </button>
          <span className="dialog-eyebrow">PANPACIFIC UNIVERSITY</span>
          <h2 id="dialog-title">
            {dialogContent === "About"
              ? "SupplyHub"
              : dialogContent}
          </h2>
          {dialogContent === "About" ? (
            <p>
              A central place for the university community to find supplies,
              check availability, and stay informed about stock updates.
            </p>
          ) : (
            <>
              <span className="dialog-feature-icon">
                <FeatureIcon kind={dialogContent} />
              </span>
              <h3>View current supply availability</h3>
              <p>Browse the selected stock list on this page. Admins manage stock quantities. Staff can sign in to submit supply requests.</p>
              <Link className="dialog-done" href="#available-stock" onClick={() => dialogRef.current?.close()}>View available stock</Link>
            </>
          )}
          <button
            className="dialog-done"
            onClick={() => dialogRef.current?.close()}
          >
            Back to home
          </button>
        </div>
      </dialog>
    </div>
  );
}
