# Third-party notices

Print Partner includes open-source software. This file summarizes licenses for **direct runtime dependencies** of the web monorepo (`web/`, as declared in workspace `package.json` files and resolved via `package-lock.json`). Transitive dependencies are also installed; inspect `node_modules` or run a license scanner for a full list.

## Inspiration

Print Partner’s workflow builds on work shared by the 3D Printing Community and by [ThunderKeys' STL Manifest Generator](https://github.com/thunderkeys/stl-manifest-generator). See [ATTRIBUTION.md](ATTRIBUTION.md). Print Partner itself is licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](LICENSE).

## npm packages (direct dependencies)

| Package | Version | License | URL |
|---------|---------|---------|-----|
| @aws-sdk/client-s3 | 3.1075.0 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-s3 |
| @dnd-kit/core | 6.3.1 | MIT | https://github.com/clauderic/dnd-kit |
| @dnd-kit/sortable | 10.0.0 | MIT | https://github.com/clauderic/dnd-kit |
| @dnd-kit/utilities | 3.2.2 | MIT | https://github.com/clauderic/dnd-kit |
| @fastify/cookie | 11.0.2 | MIT | https://github.com/fastify/fastify-cookie#readme |
| @fastify/cors | 11.2.0 | MIT | https://github.com/fastify/fastify-cors#readme |
| @fastify/multipart | 10.0.0 | MIT | https://github.com/fastify/fastify-multipart#readme |
| @fastify/oauth2 | 8.2.0 | MIT | https://github.com/fastify/fastify-oauth2#readme |
| @fastify/rate-limit | 11.0.0 | MIT | https://github.com/fastify/fastify-rate-limit#readme |
| @fastify/secure-session | 8.3.0 | MIT | https://github.com/fastify/fastify-secure-session#readme |
| @fastify/static | 9.1.3 | MIT | https://github.com/fastify/fastify-static |
| @fastify/swagger | 9.7.0 | MIT | https://github.com/fastify/fastify-swagger#readme |
| @fastify/swagger-ui | 6.0.0 | MIT | https://github.com/fastify/fastify-swagger-ui#readme |
| @fastify/websocket | 11.2.0 | MIT | https://github.com/fastify/fastify-websocket#readme |
| @modelcontextprotocol/sdk | 1.30.0 | undefined |  |
| @octokit/rest | 22.0.1 | SEE PACKAGE |  |
| @print-partner/contracts | * | SEE PACKAGE |  |
| @print-partner/domain | * | SEE PACKAGE |  |
| @radix-ui/react-dialog | 1.1.17 | SEE PACKAGE |  |
| @radix-ui/react-dropdown-menu | 2.1.18 | SEE PACKAGE |  |
| @radix-ui/react-label | 2.1.10 | SEE PACKAGE |  |
| @radix-ui/react-popover | 1.1.17 | SEE PACKAGE |  |
| @radix-ui/react-scroll-area | 1.2.12 | SEE PACKAGE |  |
| @radix-ui/react-select | 2.3.1 | SEE PACKAGE |  |
| @radix-ui/react-separator | 1.1.10 | SEE PACKAGE |  |
| @radix-ui/react-slot | 1.3.0 | SEE PACKAGE |  |
| @radix-ui/react-switch | 1.3.1 | SEE PACKAGE |  |
| @radix-ui/react-tabs | 1.1.15 | SEE PACKAGE |  |
| @radix-ui/react-tooltip | 1.2.10 | SEE PACKAGE |  |
| @tailwindcss/vite | 4.3.1 | SEE PACKAGE |  |
| @tanstack/react-query | 5.101.2 | MIT | https://tanstack.com/query |
| @types/nodemailer | 8.0.1 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/nodemailer |
| adm-zip | 0.5.17 | MIT | https://github.com/cthackers/adm-zip |
| better-sqlite3 | 12.11.1 | MIT | http://github.com/WiseLibs/better-sqlite3 |
| class-variance-authority | 0.7.1 | SEE PACKAGE |  |
| clsx | 2.1.1 | SEE PACKAGE |  |
| cmdk | 1.1.1 | SEE PACKAGE |  |
| drizzle-orm | 0.45.2 | SEE PACKAGE |  |
| fastify | 5.8.5 | MIT | https://fastify.dev/ |
| fflate | 0.8.3 | MIT | https://101arrowz.github.io/fflate |
| js-yaml | 5.2.0 | MIT | nodeca/js-yaml |
| jszip | 3.10.1 | (MIT OR GPL-3.0-or-later) | https://github.com/Stuk/jszip |
| lucide-react | 1.21.0 | ISC | https://lucide.dev |
| nodemailer | 9.0.3 | MIT-0 | https://nodemailer.com/ |
| pdf-parse | 2.4.5 | SEE PACKAGE |  |
| pg | 8.22.0 | MIT | https://github.com/brianc/node-postgres |
| react | 19.2.7 | MIT | https://react.dev/ |
| react-dom | 19.2.7 | MIT | https://react.dev/ |
| react-resizable-panels | 4.11.2 | MIT | https://react-resizable-panels.vercel.app/ |
| react-router-dom | 7.18.0 | MIT | https://github.com/remix-run/react-router |
| sonner | 2.0.7 | SEE PACKAGE |  |
| tailwind-merge | 3.6.0 | SEE PACKAGE |  |
| three | 0.184.0 | SEE PACKAGE |  |

Versions reflect the lockfile at generation time; exact versions may vary slightly by install.

## 3MF export

Print Partner writes 3MF archives using **fflate** (ZIP) and hand-authored Core + Materials XML. It does **not** bundle native **lib3mf**.

## Optional external tool: stl-thumb

If installed on your system `PATH`, Print Partner may invoke **stl-thumb** for faster STL thumbnails:

- Project: https://github.com/unlimitedbacon/stl-thumb
- License: MIT

Print Partner does not bundle stl-thumb; install it separately if desired.

## User-provided content

STL files, Git repositories, and kit data you import remain subject to **their own** licenses and terms. Print Partner does not claim ownership of your models or third-party repo content.

## Printer preset names

Built-in printer presets use common printer model names for bed-size hints only. Print Partner is **not affiliated with or endorsed by** any printer manufacturer (including names such as Bambu Lab, Prusa Research, or Voron Design).

## Print Partner license

See [LICENSE](LICENSE) and [LICENSE-SUMMARY.md](LICENSE-SUMMARY.md).
