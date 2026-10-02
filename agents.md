# AGENTS.md

## Project

Fizzy for Gmail is an unofficial Google Apps Script Gmail add-on
that creates Fizzy cards from the email currently being viewed.

## Architecture

- `Code.gs` contains all application logic.
- `appsscript.json` is the Google Workspace Add-on manifest.
- `assets/` contains static assets.
- There are no external runtime dependencies.

## Important constraints

- Keep the project serverless.
- Do not introduce a backend unless explicitly requested.
- Do not introduce a build system unless it solves a real problem.
- Keep user-specific settings in `PropertiesService`.
- Never hard-code Fizzy credentials or tokens.
- Never log access tokens, email contents, or Fizzy response bodies.
- Do not read the Gmail body unless the feature explicitly requires it.
- Preserve support for self-hosted Fizzy URLs.

## Fizzy API

- Authenticate using the user's personal access token.
- Use the configured Fizzy base URL.
- Account/board IDs must not be hard-coded.
- Follow Fizzy pagination where applicable.
- Treat tagging as a separate operation from card creation.

## Gmail add-on

- `onGmailMessageOpen` must gracefully handle missing Gmail context.
- User actions should return CardService responses.
- Avoid generic runtime errors being surfaced to users.
- Preserve the existing Settings → user properties model.

## UI

- Keep the add-on intentionally minimal.
- Do not add unnecessary fields or navigation.
- The primary workflow is:
  Open email → choose board → optional tag → Create Fizzy Card.

## Security

- Never commit tokens.
- Never put credentials in `appsscript.json`.
- Never expose user properties in logs.
- Changes involving OAuth scopes require README documentation.

## Before changing code

Read:

- `README.md`
- `Code.gs`
- `appsscript.json`

Prefer small, isolated changes over rewriting the application.

## Deployment

The project is designed to run entirely in the user's Google account.
Do not change this architecture without explicit approval.
