# Print Partner — license explained

Print Partner is licensed under the **[Creative Commons
Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](LICENSE)**.
That file is the **legal text**. This page explains what it means in everyday
language. If this summary and the license disagree, **the license wins**.

| Document | Purpose |
|----------|---------|
| [LICENSE](LICENSE) | Full CC BY-NC 4.0 license text (binding) |
| This file | Plain-language explanation |
| [ATTRIBUTION.md](ATTRIBUTION.md) | Credit to the 3D Printing Community and ThunderKeys' STL Manifest Generator |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Licenses for libraries and tools Print Partner uses |

**Official license deed:** https://creativecommons.org/licenses/by-nc/4.0/

---

## What CC BY-NC 4.0 means

You are free to:

- **Share** — copy and redistribute Print Partner in any medium or format.
- **Adapt** — remix, transform, and build upon Print Partner.

The licensor cannot revoke these freedoms as long as you follow the license
terms.

Under the following terms:

- **Attribution** — You must give appropriate credit, provide a link to the
  license, and indicate if changes were made. See [ATTRIBUTION.md](ATTRIBUTION.md).
- **NonCommercial** — You may not use the material for commercial purposes
  without separate permission.

---

## In practice

You **may**:

- Run Print Partner on your own machines for personal, hobby, academic, or
  other non-commercial use.
- Study, modify, and adapt the source code for non-commercial use.
- Share the app or your modifications, as long as recipients get the same
  attribution and license notices.

You may **not**, without separate permission:

- Use Print Partner primarily for commercial advantage or monetary
  compensation (for example, selling the software, bundling it in a paid
  product, or offering it as a paid hosted/managed service).

---

## Self-host vs hosted / SaaS

Print Partner ships as a **web application + API** (Docker self-host by
default; optional multi-tenant SaaS compose for operators who hold rights).

| Mode | What it means under this license |
|------|----------------------------------|
| **Self-host** | You run the container (or `npm run dev`) for your own shop, farm, or personal use. The `DEPLOY_MODE=self-host` path (SQLite + local disk) is the intended community deployment. |
| **SaaS / paid hosted** | Offering Print Partner as a paid managed service, multi-tenant hosting, or commercial API to others is **NonCommercial-restricted**. The repo’s `docker-compose.saas.yml` is a reference for operators who already have permission (for example the copyright holders), not a grant for third parties to run a commercial hosted product. |

When in doubt about whether your use is “commercial,” seek your own advice.

---

## Notes

- **Selling physical parts** you print is about your **printed products**, not
  the software. The CC BY-NC 4.0 license applies to **Print Partner the
  software**. Whether a particular use is "commercial" under the license
  depends on your circumstances; when in doubt, seek your own advice.
- **[Ko-fi tips](https://ko-fi.com/poitee)** are voluntary support and do not
  grant any commercial license rights.
- The software is provided **as is**, without warranties. See the
  **Disclaimer of Warranties and Limitation of Liability** section in
  [LICENSE](LICENSE).
