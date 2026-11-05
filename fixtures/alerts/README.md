# Job Alert Email Fixtures

> [!IMPORTANT]
> The `.eml` fixtures located in this repository are **synthetic test fixtures** crafted to model the HTML structure of alert digest emails from LinkedIn, Naukri, and Indeed.
>
> In production, portal HTML markup changes periodically. Before relying on these parsers, capture real anonymised job alert emails from your own inbox, save them as `.eml` files, and verify them using the offline inspection script:
>
> ```bash
> pnpm parse-eml <path/to/email.eml>
> ```

See `packages/shared/fixtures/alerts/` for the test fixture files.
