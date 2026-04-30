# EnvX

EnvX is a lightweight browser app for managing `.env` variables across projects and environments.

It uses Firebase Auth for accounts and Firestore for readable workspace data. No build step is required.

## ✨ Features

- 🔐 **Firebase Auth**: email/password login, registration, confirm password, logout, and session loading state.
- 🗂️ **Projects**: create and manage multiple projects from one workspace.
- 🌈 **Environments**: default `dev`, `staging`, and `prod` tabs with blue, orange, and red visual states.
- 🔑 **Variables**: add, edit, delete, reveal, and copy environment variables.
- 📥 **Import**: import variables from a `.env` file or pasted `.env` text.
- 📤 **Export**: preview variables as `.env` text, copy them, or download an `.env` file.
- 🕘 **Version history**: automatic snapshots on variable changes with restore support.
- 🔍 **Diff tool**: compare versions or environments in a modal.
- 🧩 **Zero build**: static HTML, CSS, and JavaScript.

## 🚀 Setup

1. Create a Firebase project.
2. Enable **Authentication > Email/Password**.
3. Create a Firestore database.
4. Update the Firebase config if you are using your own Firebase project:

```bash
cp firebase-config.example.js firebase-config.js
```

5. Paste your Firebase web app config into `firebase-config.js`.
6. Open `index.html` in a modern browser.

## 🔥 Firestore Rules

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

## 🧱 Data Model

EnvX stores each user's readable workspace document at:

```txt
users/{uid}
```

That document contains workspace metadata, projects, environments, variables, and version snapshots.

## 🛡️ Security Note

Firebase web config is public app configuration, not a password. It can be committed for static hosting. Firestore security rules are what protect user data.

This app stores variable values as readable Firestore data. Do not use it for highly sensitive production secrets unless that matches your security model.
