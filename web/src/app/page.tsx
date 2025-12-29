import Link from "next/link";

export default function Home() {
  return (
    <>
      <div className="bg" aria-hidden="true" />

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
            <Link className="tab active" href="/">
              Home
            </Link>
            <Link className="tab" href="/github">
              GitHub
            </Link>
          </nav>
        </div>
      </header>

      <main className="simple">
        <section className="simple-card" aria-label="Login">
          <div className="candle" aria-hidden="true">
            <span className="candle-flame" />
            <span className="candle-body" />
          </div>

          <form className="simple-form" action="#" method="post">
            <label className="field">
              <span className="label">Username</span>
              <input
                type="text"
                name="username"
                placeholder="Username"
                autoComplete="username"
                inputMode="text"
              />
            </label>

            <label className="field">
              <span className="label">Password</span>
              <input
                type="password"
                name="password"
                placeholder="Password"
                autoComplete="current-password"
              />
            </label>

            <Link className="button" href="/home" aria-label="Login">
              Login
            </Link>
          </form>
        </section>
      </main>
    </>
  );
}
