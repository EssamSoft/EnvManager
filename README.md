# EnvX

EnvX is a small browser app for managing `.env` variables across projects and environments.

It uses Firebase Auth for accounts and Firestore for readable workspace data.

## Features

- Email/password login and registration
- Projects with `dev`, `staging`, and `prod` environments
- Add, edit, delete, import, and copy environment variables
- Import from a `.env` file or pasted `.env` text
- Automatic version snapshots
- Version restore and diff tools
- No build step

## Setup

1. Create a Firebase project.
2. Enable **Authentication > Email/Password**.
3. Create a Firestore database.
4. Copy the example config:

```bash
cp firebase-config.example.js firebase-config.js
```

5. Paste your Firebase web app config into `firebase-config.js`.
6. Open `index.html` in a browser.

`firebase-config.js` is ignored by Git so your project config is not committed.

## Firestore Rules

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Data Model

EnvX stores each user's readable workspace document at:

```txt
users/{uid}
```

The document contains workspace metadata, projects, environments, variables, and version snapshots.

## Security Note

Firebase web config is public app configuration, not a password. Firestore security rules are what protect user data.
