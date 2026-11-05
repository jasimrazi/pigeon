# Job Alert Email Fixtures

> [!IMPORTANT]
> The `.eml` fixtures located in this directory are **synthetic test fixtures** crafted to model the HTML structure of alert digest emails from LinkedIn, Naukri, and Indeed.
>
> In production, portal HTML markup changes periodically. Before relying on these parsers, capture real anonymised job alert emails from your own inbox, save them as `.eml` files, and verify them using the offline inspection script:
>
> ```bash
> pnpm parse-eml <path/to/email.eml>
> ```

## Available Fixtures

- `linkedin-digest.eml`: Synthetic LinkedIn daily digest alert containing job cards with title, company, location, salary, and tracking parameters.
- `naukri-digest.eml`: Synthetic Naukri daily recommendation digest with Indian tech hub locations and CTC ranges.
- `indeed-digest.eml`: Synthetic Indeed alert email containing job keys (`jk`) and salary ranges.
- `empty-digest.eml`: Real alert format indicating 0 matching jobs (used for parser health and empty streak tracking).
- `unauthorized-sender.eml`: Email from an unapproved domain, verifying rejection and payload-free logging.
- `wrong-forwarding.eml`: Alert email where the envelope sender does not match the configured forwarding address.

## Testing Your Own Emails Offline

You can test any `.eml` file locally without database or network access:

```bash
pnpm parse-eml my-saved-email.eml
```
