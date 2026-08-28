# GrokPulse marketing site

A standalone, dependency-free landing page for GrokPulse — not part of the
`apps/web` Next.js application. Open `index.html` directly in a browser, or
serve `marketing/` as a static site (e.g. behind the project's main domain,
or as its own Vercel/Netlify/S3+CloudFront deployment).

```
marketing/
├── index.html      the page itself (fonts load from Google Fonts; the logo
│                    is the only local asset)
└── assets/
    └── logo.png     brand mark used in the nav, hero, and footer
```

No build step, no dependencies. Edit `index.html` directly.
