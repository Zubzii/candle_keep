import Link from "next/link";

type DealRow = {
  company: string;
  source: string;
  price: string;
  updated: string;
};

const topDeals: DealRow[] = [
  { company: "Northwind AI", source: "Crunchbase", price: "$2.1M", updated: "Today" },
  { company: "Cinder Robotics", source: "AngelList", price: "$950K", updated: "1d" },
  { company: "Harbor Health", source: "RSS", price: "$4.7M", updated: "2d" },
  { company: "Lumen Grid", source: "Email", price: "$1.3M", updated: "3d" },
];

const recentScrapes: DealRow[] = [
  { company: "Maple Bio", source: "Site scrape", price: "—", updated: "10m" },
  { company: "Pinecone Freight", source: "Site scrape", price: "—", updated: "22m" },
  { company: "Redwood Energy", source: "Site scrape", price: "—", updated: "44m" },
  { company: "Opal Fintech", source: "Site scrape", price: "—", updated: "1h" },
];

const watchlist: DealRow[] = [
  { company: "Aster Labs", source: "Manual", price: "$3.0M", updated: "This week" },
  { company: "Quill Ops", source: "Manual", price: "$1.1M", updated: "This week" },
  { company: "Nimbus Retail", source: "Manual", price: "$780K", updated: "This week" },
  { company: "Saffron Security", source: "Manual", price: "$6.4M", updated: "This week" },
];

const notesQueue: DealRow[] = [
  { company: "Kite Analytics", source: "Notes", price: "—", updated: "Today" },
  { company: "Cobalt Supply", source: "Notes", price: "—", updated: "Today" },
  { company: "Juniper Legal", source: "Notes", price: "—", updated: "Yesterday" },
  { company: "Mosaic Payments", source: "Notes", price: "—", updated: "Yesterday" },
];

function Table({ rows }: { rows: DealRow[] }) {
  return (
    <div className="table-wrap">
      <table className="table" aria-label="Deals table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Source</th>
            <th>Price</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.company}-${r.source}-${r.updated}`}>
              <td className="strong">{r.company}</td>
              <td>{r.source}</td>
              <td>{r.price}</td>
              <td>{r.updated}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="dash">
      <header className="nav">
        <div className="nav-inner">
          <Link className="nav-brand" href="/" aria-label="Candle Keep">
            <span className="candle nav-icon" aria-hidden="true">
              <span className="candle-flame" />
              <span className="candle-body" />
            </span>
            <span className="nav-title">Candle Keep</span>
          </Link>
          <nav className="nav-tabs" aria-label="Navigation">
            <Link className="tab active" href="/home">
              Home
            </Link>
            <Link className="tab" href="/github">
              GitHub
            </Link>
          </nav>
        </div>
      </header>

      <div className="dash-top">
        <div className="dash-brand" aria-label="Page title">
          <div>
            <div className="dash-title">Home</div>
            <div className="dash-subtitle">Dummy data only (no scraping/auth wired yet).</div>
          </div>
        </div>
        <Link className="chip" href="/">
          Back to Login
        </Link>
      </div>

      <section className="quadrants" aria-label="Dashboard">
        <div className="quad">
          <div className="quad-title">Top Deals</div>
          <Table rows={topDeals} />
        </div>

        <div className="quad">
          <div className="quad-title">Recent Scrapes</div>
          <Table rows={recentScrapes} />
        </div>

        <div className="quad">
          <div className="quad-title">Watchlist</div>
          <Table rows={watchlist} />
        </div>

        <div className="quad">
          <div className="quad-title">Notes Queue</div>
          <Table rows={notesQueue} />
        </div>
      </section>
    </main>
  );
}


