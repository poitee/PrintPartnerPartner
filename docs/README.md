# GitHub Pages (project site)

This folder hosts a minimal static landing page for the Print Partner web app (`index.html`). It describes the self-hostable web platform and embeds the workflow screenshots from [`screenshots/`](./screenshots/). No build step is required.

## Enable GitHub Pages

1. Open the repository on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch** (or use the **GitHub Actions** workflow if you prefer automated deploys).
3. For branch deploy: choose branch `main`, folder **`/docs`**, then **Save**.
4. After a minute or two, the site is available at  
   `https://<user-or-org>.github.io/PrintPartnerPartner/`  
   (exact URL is shown on the Pages settings screen).

## Automated deploy (optional)

The workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) uploads the `/docs` folder as a Pages artifact on pushes to `main`. To use it:

1. **Settings** → **Pages** → **Source**: **GitHub Actions**.
2. Push to `main`; the **pages** workflow publishes `docs/`.

## Local preview

Open `docs/index.html` in a browser, or:

```bash
python3 -m http.server 8765 --directory docs
```

Then visit http://localhost:8765/

## Screenshots

Workflow screenshots live in [`screenshots/`](screenshots/) and are referenced from the root [README](../README.md). See [`screenshots/README.md`](screenshots/README.md) for capture instructions against the self-host Docker app.
