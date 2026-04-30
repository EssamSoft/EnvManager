# EnvX

EnvX is a lightweight browser MVP for managing `.env` variables across projects and environments.

## What is included

- Register and log in to a workspace vault
- Workspace isolation by email and workspace name
- AES-GCM encrypted local persistence using a password-derived key
- Project and environment management
- Structured key-value environment variables
- Automatic version snapshots on every variable change
- Version restore
- Diff between two versions or two environments

## Run

Open `index.html` in a modern browser.

No build step or package install is required.

## Notes

This MVP stores encrypted data in browser `localStorage`. Variable values are decrypted only after login and kept in memory for the session. For a production deployment, move the data model to a backend such as Laravel/PostgreSQL or Firebase Auth/Firestore and use server-side tenant enforcement.
