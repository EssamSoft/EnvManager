import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
isSupported().then((supported) => {
  if (supported) getAnalytics(firebaseApp);
});

const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let authMode = "login";
let authInProgress = false;
let authChecking = true;
let session = null;
let state = null;
let selectedProjectId = null;
let selectedEnvironmentId = null;
let editingKey = null;
const revealedKeys = new Set();

const $ = (id) => document.getElementById(id);

const elements = {
  authPanel: $("authPanel"),
  loadingState: $("loadingState"),
  workspacePanel: $("workspacePanel"),
  projectPanel: $("projectPanel"),
  lockedState: $("lockedState"),
  dashboard: $("dashboard"),
  loginTab: $("loginTab"),
  registerTab: $("registerTab"),
  authForm: $("authForm"),
  authSubmit: $("authSubmit"),
  authNote: $("authNote"),
  emailInput: $("emailInput"),
  passwordInput: $("passwordInput"),
  confirmPasswordField: $("confirmPasswordField"),
  confirmPasswordInput: $("confirmPasswordInput"),
  workspaceName: $("workspaceName"),
  userEmail: $("userEmail"),
  lockButton: $("lockButton"),
  projectList: $("projectList"),
  addProjectButton: $("addProjectButton"),
  addEnvButton: $("addEnvButton"),
  deleteEnvButton: $("deleteEnvButton"),
  deleteProjectButton: $("deleteProjectButton"),
  projectTitle: $("projectTitle"),
  projectKicker: $("projectKicker"),
  envTabs: $("envTabs"),
  envTitle: $("envTitle"),
  envMeta: $("envMeta"),
  variableRows: $("variableRows"),
  addVariableButton: $("addVariableButton"),
  importEnvButton: $("importEnvButton"),
  exportEnvButton: $("exportEnvButton"),
  importDialog: $("importDialog"),
  exportDialog: $("exportDialog"),
  exportMeta: $("exportMeta"),
  envExportOutput: $("envExportOutput"),
  copyExportButton: $("copyExportButton"),
  downloadEnvButton: $("downloadEnvButton"),
  chooseEnvFileButton: $("chooseEnvFileButton"),
  importEnvTextButton: $("importEnvTextButton"),
  envTextInput: $("envTextInput"),
  openHistoryButton: $("openHistoryButton"),
  openDiffButton: $("openDiffButton"),
  envFileInput: $("envFileInput"),
  variableForm: $("variableForm"),
  keyInput: $("keyInput"),
  valueInput: $("valueInput"),
  saveVariableButton: $("saveVariableButton"),
  cancelVariableButton: $("cancelVariableButton"),
  historyList: $("historyList"),
  historyMeta: $("historyMeta"),
  historyDialog: $("historyDialog"),
  diffType: $("diffType"),
  diffLeft: $("diffLeft"),
  diffRight: $("diffRight"),
  runDiffButton: $("runDiffButton"),
  diffResult: $("diffResult"),
  diffDialog: $("diffDialog"),
  promptDialog: $("promptDialog"),
  dialogTitle: $("dialogTitle"),
  dialogInput: $("dialogInput"),
  toast: $("toast")
};

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const defaultWorkspaceName = (email) => {
  const name = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return `${name || "Personal"} Workspace`.replace(/\b\w/g, (char) => char.toUpperCase());
};
const formatDate = (value) => new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
}).format(new Date(value));

function initialState(workspace, email) {
  const projectId = id();
  const envs = ["dev", "staging", "prod"].map((name) => ({
    id: id(),
    name,
    variables: {},
    versions: [],
    createdAt: now()
  }));

  return {
    workspace,
    ownerEmail: email,
    projects: [{
      id: projectId,
      name: "First Project",
      environments: envs,
      createdAt: now()
    }]
  };
}

function userDocRef(uid = session?.uid) {
  return doc(db, "users", uid);
}

async function loadUserState(user) {
  const snapshot = await getDoc(userDocRef(user.uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return {
    workspace: data.workspace,
    ownerEmail: data.ownerEmail || user.email,
    projects: data.projects || []
  };
}

async function saveUserState(user, nextState) {
  await setDoc(userDocRef(user.uid), {
    ...nextState,
    email: user.email,
    uid: user.uid,
    updatedAt: now()
  }, { merge: true });
}

async function persist(message) {
  if (!session) return;
  await saveUserState(session.user, state);
  if (message) toast(message);
}

function snapshotEnvironment(environment, label) {
  environment.versions.unshift({
    id: id(),
    label,
    snapshot: structuredClone(environment.variables),
    createdAt: now()
  });
}

function getProject() {
  return state?.projects.find((project) => project.id === selectedProjectId) || null;
}

function getEnvironment() {
  return getProject()?.environments.find((environment) => environment.id === selectedEnvironmentId) || null;
}

function sortedVariables(environment) {
  return Object.entries(environment?.variables || {}).sort(([a], [b]) => a.localeCompare(b));
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function setAuthMode(mode) {
  authMode = mode;
  elements.loginTab.classList.toggle("active", mode === "login");
  elements.registerTab.classList.toggle("active", mode === "register");
  elements.confirmPasswordField.classList.toggle("hidden", mode !== "register");
  elements.confirmPasswordInput.required = mode === "register";
  elements.passwordInput.autocomplete = mode === "register" ? "new-password" : "current-password";
  elements.authSubmit.textContent = mode === "login" ? "Unlock Vault" : "Create Vault";
  elements.authNote.textContent = mode === "login"
    ? "Firebase signs you in and loads your workspace."
    : "Your workspace starts with dev, staging, and prod environments.";
}

async function handleAuth(event) {
  event.preventDefault();
  const email = elements.emailInput.value.trim().toLowerCase();
  const password = elements.passwordInput.value;
  const confirmPassword = elements.confirmPasswordInput.value;

  try {
    authInProgress = true;
    elements.authSubmit.disabled = true;
    if (authMode === "register") {
      if (password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const workspace = defaultWorkspaceName(credential.user.email || email);
      const freshState = initialState(workspace, email);
      await saveUserState(credential.user, {
        ...freshState,
        createdAt: now()
      });
      session = { uid: credential.user.uid, user: credential.user, email, workspace };
      state = freshState;
    } else {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const loadedState = await loadUserState(credential.user);
      if (!loadedState) throw new Error("No workspace found for this account.");
      session = {
        uid: credential.user.uid,
        user: credential.user,
        email: credential.user.email || email,
        workspace: loadedState.workspace
      };
      state = loadedState;
    }

    selectedProjectId = state.projects[0]?.id || null;
    selectedEnvironmentId = getProject()?.environments[0]?.id || null;
    elements.authForm.reset();
    render();
    toast("Workspace loaded.");
  } catch (error) {
    toast(friendlyAuthError(error));
  } finally {
    authInProgress = false;
    elements.authSubmit.disabled = false;
  }
}

function friendlyAuthError(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for that email.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/configuration-not-found": "Enable Email/Password sign-in in Firebase Authentication.",
    "permission-denied": "Firestore rules blocked this request."
  };
  return messages[error.code] || error.message || "Firebase request failed.";
}

async function lock() {
  await signOut(auth);
  session = null;
  state = null;
  selectedProjectId = null;
  selectedEnvironmentId = null;
  editingKey = null;
  render();
}

function render() {
  if (authChecking) {
    elements.authPanel.classList.add("hidden");
    elements.workspacePanel.classList.add("hidden");
    elements.projectPanel.classList.add("hidden");
    elements.lockedState.classList.add("hidden");
    elements.dashboard.classList.add("hidden");
    elements.loadingState.classList.remove("hidden");
    return;
  }

  const unlocked = Boolean(session && state);
  elements.loadingState.classList.add("hidden");
  elements.authPanel.classList.toggle("hidden", unlocked);
  elements.workspacePanel.classList.toggle("hidden", !unlocked);
  elements.projectPanel.classList.toggle("hidden", !unlocked);
  elements.lockedState.classList.toggle("hidden", unlocked);
  elements.dashboard.classList.toggle("hidden", !unlocked);

  if (!unlocked) return;
  elements.workspaceName.textContent = state.workspace;
  elements.userEmail.textContent = state.ownerEmail;
  renderProjects();
  renderDashboard();
}

function renderProjects() {
  elements.projectList.innerHTML = "";
  state.projects.forEach((project) => {
    const button = document.createElement("button");
    button.className = `list-item ${project.id === selectedProjectId ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `<span>${escapeHtml(project.name)}</span><span>${project.environments.length}</span>`;
    button.addEventListener("click", () => {
      selectedProjectId = project.id;
      selectedEnvironmentId = project.environments[0]?.id || null;
      render();
    });
    elements.projectList.append(button);
  });
}

function renderDashboard() {
  const project = getProject();
  const environment = getEnvironment();
  elements.projectTitle.textContent = project?.name || "No project";
  elements.projectKicker.textContent = `${state.projects.length} project${state.projects.length === 1 ? "" : "s"}`;
  elements.envTabs.innerHTML = "";

  project?.environments.forEach((env) => {
    const tab = document.createElement("button");
    tab.className = `env-tab ${environmentToneClass(env.name)} ${env.id === selectedEnvironmentId ? "active" : ""}`;
    tab.type = "button";
    tab.textContent = env.name;
    tab.addEventListener("click", () => {
      selectedEnvironmentId = env.id;
      editingKey = null;
      render();
    });
    elements.envTabs.append(tab);
  });

  elements.envTitle.textContent = environment ? `${environment.name} variables` : "Variables";
  elements.envMeta.textContent = environment
    ? `${Object.keys(environment.variables).length} keys, ${environment.versions.length} versions`
    : "No environment selected";
  renderVariables(environment);
  renderHistory(environment);
  renderDiffSelectors();
}

function environmentToneClass(name) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "dev") return "env-dev";
  if (normalized === "staging") return "env-staging";
  if (normalized === "prod") return "env-prod";
  return "";
}

function renderExportDialog() {
  const environment = getEnvironment();
  const project = getProject();
  const text = serializeEnvironment(environment);
  elements.envExportOutput.value = text;
  elements.exportMeta.textContent = environment
    ? `${project?.name || "Project"} / ${environment.name} - ${Object.keys(environment.variables).length} keys`
    : "No environment selected";
}

function serializeEnvironment(environment) {
  return sortedVariables(environment)
    .map(([key, entry]) => `${key}=${formatEnvValue(entry.value)}`)
    .join("\n");
}

function formatEnvValue(value) {
  const stringValue = String(value ?? "");
  if (!stringValue) return "";
  if (/[\s#"'\\\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/"/g, '\\"')}"`;
  }
  return stringValue;
}

function renderVariables(environment) {
  elements.variableRows.innerHTML = "";
  if (!environment || sortedVariables(environment).length === 0) {
    elements.variableRows.innerHTML = `<tr><td colspan="4" class="masked">No variables yet.</td></tr>`;
    return;
  }

  sortedVariables(environment).forEach(([key, entry]) => {
    const isRevealed = revealedKeys.has(revealKey(environment.id, key));
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code>${escapeHtml(key)}</code></td>
      <td class="${isRevealed ? "revealed-value" : "masked"}">${
        isRevealed ? escapeHtml(entry.value) : "•".repeat(Math.min(String(entry.value).length || 6, 24))
      }</td>
      <td>${formatDate(entry.updatedAt)}</td>
      <td>
        <div class="row-actions">
          <button class="tiny" data-action="reveal" data-key="${escapeAttr(key)}" type="button">${isRevealed ? "Hide" : "Reveal"}</button>
          <button class="tiny" data-action="edit" data-key="${escapeAttr(key)}" type="button">Edit</button>
          <button class="tiny" data-action="delete" data-key="${escapeAttr(key)}" type="button">Delete</button>
        </div>
      </td>
    `;
    elements.variableRows.append(row);
  });
}

function revealKey(environmentId, key) {
  return `${environmentId}:${key}`;
}

function renderHistory(environment) {
  elements.historyList.innerHTML = "";
  elements.historyMeta.textContent = environment ? `${environment.versions.length} automatic snapshots` : "Automatic snapshots";
  if (!environment || environment.versions.length === 0) {
    elements.historyList.innerHTML = `<div class="history-item"><span>No versions yet. The first variable change creates one.</span></div>`;
    return;
  }

  environment.versions.slice(0, 8).forEach((version) => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `
      <strong>${escapeHtml(version.label)}</strong>
      <span>${formatDate(version.createdAt)} · ${Object.keys(version.snapshot).length} keys</span>
      <div class="history-actions">
        <button class="tiny" data-action="restore" data-version="${version.id}" type="button">Restore</button>
      </div>
    `;
    elements.historyList.append(item);
  });
}

function renderDiffSelectors() {
  const project = getProject();
  const environment = getEnvironment();
  const isVersions = elements.diffType.value === "versions";
  const leftOptions = [];
  const rightOptions = [];

  if (isVersions) {
    environment?.versions.forEach((version) => {
      const label = `${version.label} - ${formatDate(version.createdAt)}`;
      leftOptions.push({ value: version.id, label });
      rightOptions.push({ value: version.id, label });
    });
  } else {
    project?.environments.forEach((env) => {
      leftOptions.push({ value: env.id, label: env.name });
      rightOptions.push({ value: env.id, label: env.name });
    });
  }

  fillSelect(elements.diffLeft, leftOptions, leftOptions[0]?.value);
  fillSelect(elements.diffRight, rightOptions, rightOptions[1]?.value || rightOptions[0]?.value);

  if (elements.diffLeft.value === elements.diffRight.value && rightOptions.length > 1) {
    const alternate = rightOptions.find((option) => option.value !== elements.diffLeft.value);
    elements.diffRight.value = alternate.value;
  }
}

function fillSelect(select, options, fallback) {
  const previous = select.value;
  select.innerHTML = "";
  options.forEach((option) => {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  });
  select.value = options.some((option) => option.value === previous) ? previous : fallback || options[0]?.value || "";
}

async function createProject() {
  const name = await promptFor("Create project", "Project name");
  if (!name) return;
  const previousProjects = structuredClone(state.projects);
  const previousProjectId = selectedProjectId;
  const previousEnvironmentId = selectedEnvironmentId;
  try {
    const envs = ["dev", "staging", "prod"].map((envName) => ({
      id: id(),
      name: envName,
      variables: {},
      versions: [],
      createdAt: now()
    }));
    const project = { id: id(), name, environments: envs, createdAt: now() };
    state.projects.unshift(project);
    selectedProjectId = project.id;
    selectedEnvironmentId = envs[0].id;
    await persist("Project created.");
    render();
  } catch (error) {
    state.projects = previousProjects;
    selectedProjectId = previousProjectId;
    selectedEnvironmentId = previousEnvironmentId;
    render();
    toast(friendlyAuthError(error));
  }
}

async function createEnvironment() {
  const project = getProject();
  if (!project) return;
  const name = await promptFor("Create environment", "Environment name");
  if (!name) return;
  if (project.environments.some((env) => env.name.toLowerCase() === name.toLowerCase())) {
    toast("Environment already exists.");
    return;
  }
  const environment = { id: id(), name, variables: {}, versions: [], createdAt: now() };
  project.environments.push(environment);
  selectedEnvironmentId = environment.id;
  await persist("Environment created.");
  render();
}

async function deleteProject() {
  const project = getProject();
  if (!project || !confirm(`Delete project "${project.name}"?`)) return;
  state.projects = state.projects.filter((item) => item.id !== project.id);
  selectedProjectId = state.projects[0]?.id || null;
  selectedEnvironmentId = getProject()?.environments[0]?.id || null;
  await persist("Project deleted.");
  render();
}

async function deleteEnvironment() {
  const project = getProject();
  const environment = getEnvironment();
  if (!project || !environment) return;
  if (project.environments.length === 1) {
    toast("A project must keep at least one environment.");
    return;
  }
  if (!confirm(`Delete environment "${environment.name}"?`)) return;
  project.environments = project.environments.filter((item) => item.id !== environment.id);
  selectedEnvironmentId = project.environments[0]?.id || null;
  await persist("Environment deleted.");
  render();
}

function showVariableForm(key = null) {
  const environment = getEnvironment();
  editingKey = key;
  elements.variableForm.classList.remove("hidden");
  elements.keyInput.value = key || "";
  elements.keyInput.disabled = Boolean(key);
  elements.valueInput.value = key ? environment.variables[key].value : "";
  elements.saveVariableButton.textContent = key ? "Update" : "Add";
  elements.keyInput.focus();
}

function hideVariableForm() {
  editingKey = null;
  elements.variableForm.classList.add("hidden");
  elements.variableForm.reset();
  elements.keyInput.disabled = false;
}

async function saveVariable(event) {
  event.preventDefault();
  const environment = getEnvironment();
  if (!environment) return;
  const key = (editingKey || elements.keyInput.value).trim();
  const value = elements.valueInput.value;
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
    toast("Keys must start with a letter or underscore.");
    return;
  }
  snapshotEnvironment(environment, editingKey ? `Updated ${key}` : `Added ${key}`);
  environment.variables[key] = { value, updatedAt: now() };
  hideVariableForm();
  await persist("Variable saved and versioned.");
  render();
}

async function importEnvFile(event) {
  const environment = getEnvironment();
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!environment || !file) return;

  try {
    const text = await file.text();
    await importEnvText(text, file.name);
  } catch (error) {
    toast(error.message || "Could not import .env file.");
  }
}

async function importPastedEnvText() {
  const text = elements.envTextInput.value;
  if (!text.trim()) {
    toast("Paste .env text first.");
    return;
  }
  await importEnvText(text, "pasted text");
}

async function importEnvText(text, sourceLabel) {
  const environment = getEnvironment();
  if (!environment) return;

  try {
    const result = parseDotEnv(text);
    if (result.entries.length === 0) {
      toast("No valid variables found.");
      return;
    }

    const importedAt = now();
    snapshotEnvironment(environment, `Before import from ${sourceLabel}`);
    result.entries.forEach(([key, value]) => {
      environment.variables[key] = { value, updatedAt: importedAt };
    });

    elements.envTextInput.value = "";
    elements.importDialog.close();
    await persist(`Imported ${result.entries.length} variables from ${sourceLabel}.`);
    render();
  } catch (error) {
    toast(error.message || "Could not import .env text.");
  }
}

function parseDotEnv(text) {
  const variables = new Map();
  const invalidKeys = [];

  text.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    const assignment = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const equalsAt = assignment.indexOf("=");
    if (equalsAt < 1) return;

    const key = assignment.slice(0, equalsAt).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      invalidKeys.push(index + 1);
      return;
    }

    variables.set(key, parseEnvValue(assignment.slice(equalsAt + 1)));
  });

  if (invalidKeys.length > 0) {
    throw new Error(`Invalid variable key on line ${invalidKeys[0]}.`);
  }

  return { entries: [...variables.entries()] };
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const closingAt = findClosingQuote(trimmed, quote);
    if (closingAt > 0) {
      const inner = trimmed.slice(1, closingAt);
      return quote === '"' ? unescapeDoubleQuotedValue(inner) : inner;
    }
  }

  return stripInlineComment(trimmed).trim();
}

function findClosingQuote(value, quote) {
  for (let index = 1; index < value.length; index += 1) {
    if (quote === '"' && value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === quote) return index;
  }
  return -1;
}

function unescapeDoubleQuotedValue(value) {
  return value.replace(/\\([nrt"\\])/g, (_, char) => ({
    n: "\n",
    r: "\r",
    t: "\t",
    '"': '"',
    "\\": "\\"
  })[char]);
}

function stripInlineComment(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }
  return value;
}

async function deleteVariable(key) {
  const environment = getEnvironment();
  if (!environment || !confirm(`Delete ${key}?`)) return;
  snapshotEnvironment(environment, `Deleted ${key}`);
  delete environment.variables[key];
  await persist("Variable deleted and versioned.");
  render();
}

async function restoreVersion(versionId) {
  const environment = getEnvironment();
  const version = environment?.versions.find((item) => item.id === versionId);
  if (!environment || !version) return;
  snapshotEnvironment(environment, `Before restore to ${version.label}`);
  environment.variables = structuredClone(version.snapshot);
  await persist("Version restored.");
  render();
}

function runDiff() {
  const project = getProject();
  const environment = getEnvironment();
  let left = {};
  let right = {};
  let title = "";

  if (elements.diffType.value === "versions") {
    const leftVersion = environment?.versions.find((version) => version.id === elements.diffLeft.value);
    const rightVersion = environment?.versions.find((version) => version.id === elements.diffRight.value);
    if (!leftVersion || !rightVersion) {
      elements.diffResult.innerHTML = `<div class="diff-row"><span class="masked">Choose two versions to compare.</span></div>`;
      return;
    }
    left = leftVersion.snapshot;
    right = rightVersion.snapshot;
    title = `${leftVersion.label} → ${rightVersion.label}`;
  } else {
    const leftEnv = project?.environments.find((env) => env.id === elements.diffLeft.value);
    const rightEnv = project?.environments.find((env) => env.id === elements.diffRight.value);
    if (!leftEnv || !rightEnv) return;
    left = leftEnv.variables;
    right = rightEnv.variables;
    title = `${leftEnv.name} → ${rightEnv.name}`;
  }

  const diff = calculateDiff(left, right);
  renderDiff(title, diff);
}

function calculateDiff(left, right) {
  const leftKeys = new Set(Object.keys(left));
  const rightKeys = new Set(Object.keys(right));
  const added = [...rightKeys].filter((key) => !leftKeys.has(key)).sort();
  const removed = [...leftKeys].filter((key) => !rightKeys.has(key)).sort();
  const changed = [...leftKeys].filter((key) => rightKeys.has(key) && left[key].value !== right[key].value).sort();
  return { added, removed, changed, left, right };
}

function renderDiff(title, diff) {
  const rows = [];
  diff.added.forEach((key) => rows.push(diffRow("added", key, "Added", "", diff.right[key].value)));
  diff.removed.forEach((key) => rows.push(diffRow("removed", key, "Removed", diff.left[key].value, "")));
  diff.changed.forEach((key) => rows.push(diffRow("changed", key, "Changed", diff.left[key].value, diff.right[key].value)));

  elements.diffResult.innerHTML = rows.length
    ? `<div class="masked">${escapeHtml(title)}</div>${rows.join("")}`
    : `<div class="diff-row"><strong>No differences</strong><span class="masked">${escapeHtml(title)}</span></div>`;
}

function diffRow(type, key, label, from, to) {
  return `
    <div class="diff-row ${type}">
      <strong>${label}: <span class="diff-key">${escapeHtml(key)}</span></strong>
      <span class="diff-values">${escapeHtml(maskValue(from))} → ${escapeHtml(maskValue(to))}</span>
    </div>
  `;
}

function maskValue(value) {
  if (!value) return "empty";
  return "•".repeat(Math.min(String(value).length, 24));
}

function promptFor(title, placeholder) {
  elements.dialogTitle.textContent = title;
  elements.dialogInput.placeholder = placeholder;
  elements.dialogInput.value = "";

  return new Promise((resolve) => {
    const handler = () => {
      elements.promptDialog.removeEventListener("close", handler);
      const value = elements.dialogInput.value.trim();
      resolve(elements.promptDialog.returnValue === "cancel" ? "" : value);
    };
    elements.promptDialog.addEventListener("close", handler);
    elements.promptDialog.showModal();
    elements.dialogInput.focus();
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function openExportDialog() {
  renderExportDialog();
  elements.exportDialog.showModal();
}

function copyExportText() {
  navigator.clipboard?.writeText(elements.envExportOutput.value);
  toast("Export copied.");
}

function downloadEnvFile() {
  const environment = getEnvironment();
  if (!environment) return;
  const blob = new Blob([elements.envExportOutput.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${environment.name}.env`;
  link.click();
  URL.revokeObjectURL(url);
}

function closeDialogOnBackdropClick(dialog) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

[
  elements.promptDialog,
  elements.historyDialog,
  elements.importDialog,
  elements.exportDialog,
  elements.diffDialog
].forEach(closeDialogOnBackdropClick);

elements.loginTab.addEventListener("click", () => setAuthMode("login"));
elements.registerTab.addEventListener("click", () => setAuthMode("register"));
elements.authForm.addEventListener("submit", handleAuth);
elements.lockButton.addEventListener("click", lock);
elements.addProjectButton.addEventListener("click", createProject);
elements.addEnvButton.addEventListener("click", createEnvironment);
elements.deleteEnvButton.addEventListener("click", deleteEnvironment);
elements.deleteProjectButton.addEventListener("click", deleteProject);
elements.addVariableButton.addEventListener("click", () => showVariableForm());
elements.openHistoryButton.addEventListener("click", () => elements.historyDialog.showModal());
elements.openDiffButton.addEventListener("click", () => elements.diffDialog.showModal());
elements.importEnvButton.addEventListener("click", () => elements.importDialog.showModal());
elements.exportEnvButton.addEventListener("click", openExportDialog);
elements.copyExportButton.addEventListener("click", copyExportText);
elements.downloadEnvButton.addEventListener("click", downloadEnvFile);
elements.chooseEnvFileButton.addEventListener("click", () => elements.envFileInput.click());
elements.importEnvTextButton.addEventListener("click", importPastedEnvText);
elements.envFileInput.addEventListener("change", importEnvFile);
elements.cancelVariableButton.addEventListener("click", hideVariableForm);
elements.variableForm.addEventListener("submit", saveVariable);
elements.diffType.addEventListener("change", () => {
  renderDiffSelectors();
  elements.diffResult.innerHTML = "";
});
elements.runDiffButton.addEventListener("click", runDiff);

elements.variableRows.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const key = button.dataset.key;
  if (button.dataset.action === "edit") showVariableForm(key);
  if (button.dataset.action === "delete") deleteVariable(key);
  if (button.dataset.action === "reveal") {
    const environment = getEnvironment();
    const id = revealKey(environment.id, key);
    if (revealedKeys.has(id)) {
      revealedKeys.delete(id);
    } else {
      revealedKeys.add(id);
    }
    renderVariables(environment);
  }
});

elements.historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button?.dataset.action === "restore") restoreVersion(button.dataset.version);
});

onAuthStateChanged(auth, async (user) => {
  if (authInProgress) {
    authChecking = false;
    return;
  }
  if (!user) {
    session = null;
    state = null;
    authChecking = false;
    render();
    return;
  }

  try {
    const loadedState = await loadUserState(user);
    if (!loadedState) {
      await signOut(auth);
      session = null;
      state = null;
      authChecking = false;
      render();
      return;
    }
    session = {
      uid: user.uid,
      user,
      email: user.email,
      workspace: loadedState.workspace
    };
    state = loadedState;
    selectedProjectId = state.projects[0]?.id || null;
    selectedEnvironmentId = getProject()?.environments[0]?.id || null;
    authChecking = false;
    render();
  } catch (error) {
    authChecking = false;
    render();
    toast(friendlyAuthError(error));
  }
});

setAuthMode("login");
render();
