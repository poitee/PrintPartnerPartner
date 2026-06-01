# GitHub Pages (project site)

This folder hosts a minimal static landing page for the Print Partner web app (`index.html`). It describes the self-hostable web platform, shows the project logo (`logo.png`), and embeds the workflow screenshots from [`screenshots/`](./screenshots/). No build step is required.

## Enable GitHub Pages

1. Open the repository on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the **pages** workflow manually); the workflow uploads `/docs` as the site artifact.
4. After a minute or two, the site is available at  
   `https://poitee.github.io/PrintPartnerPartner/`  
   (exact URL is shown on the Pages settings screen).

Branch deploy (`main` + `/docs`) also works if you prefer that over Actions.

## Local preview

Open `docs/index.html` in a browser, or:

```bash
python3 -m http.server 8765 --directory docs
```

Then visit http://localhost:8765/

## Screenshots

Workflow screenshots live in [`screenshots/`](screenshots/) and are referenced from the root [README](../README.md). See [`screenshots/README.md`](screenshots/README.md) for capture instructions against the self-host Docker app.
