const STORE_KEY = "envx.vaults";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let authMode = "login";
let session = null;
let state = null;
let selectedProjectId = null;
let selectedEnvironmentId = null;
let editingKey = null;

const $ = (id) => document.getElementById(id);

const elements = {
  authPanel: $("authPanel"),
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
  envFileInput: $("envFileInput"),
  variableForm: $("variableForm"),
  keyInput: $("keyInput"),
  valueInput: $("valueInput"),
  saveVariableButton: $("saveVariableButton"),
  cancelVariableButton: $("cancelVariableButton"),
  historyList: $("historyList"),
  historyMeta: $("historyMeta"),
  diffType: $("diffType"),
  diffLeft: $("diffLeft"),
  diffRight: $("diffRight"),
  runDiffButton: $("runDiffButton"),
  diffResult: $("diffResult"),
  promptDialog: $("promptDialog"),
  dialogTitle: $("dialogTitle"),
  dialogInput: $("dialogInput"),
  toast: $("toast")
};

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalizeWorkspace = (value) => value.trim().toLowerCase().replace(/\s+/g, "-");
const vaultId = (workspace, email) => `${normalizeWorkspace(workspace)}::${email.trim().toLowerCase()}`;
const defaultWorkspaceName = (email) => {
  const name = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return `${name || "Personal"} Workspace`.replace(/\b\w/g, (char) => char.toUpperCase());
};
const formatDate = (value) => new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
}).format(new Date(value));

function loadVaults() {
  return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
}

function saveVaults(vaults) {
  localStorage.setItem(STORE_KEY, JSON.stringify(vaults));
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function digestBase64(value) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64(hash);
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: base64ToBytes(salt), iterations: 210000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptState(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(data)));
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(encrypted) };
}

async function decryptState(key, payload) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext)
  );
  return JSON.parse(decoder.decode(decrypted));
}

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

async function persist(message) {
  if (!session) return;
  const vaults = loadVaults();
  vaults[session.vaultId].payload = await encryptState(session.key, state);
  vaults[session.vaultId].updatedAt = now();
  saveVaults(vaults);
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
  elements.authSubmit.textContent = mode === "login" ? "Unlock Vault" : "Create Vault";
  elements.authNote.textContent = mode === "login"
    ? "Your password decrypts your vault in this browser."
    : "Your personal workspace starts with dev, staging, and prod environments.";
}

async function handleAuth(event) {
  event.preventDefault();
  const email = elements.emailInput.value.trim().toLowerCase();
  const password = elements.passwordInput.value;
  const vaults = loadVaults();

  try {
    if (authMode === "register") {
      if (Object.values(vaults).some((vault) => vault.email === email)) {
        throw new Error("A vault already exists for that email.");
      }
      const workspace = defaultWorkspaceName(email);
      const keyId = vaultId(workspace, email);
      if (vaults[keyId]) throw new Error("A vault already exists for this workspace and email.");
      const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
      const key = await deriveKey(password, salt);
      const freshState = initialState(workspace, email);
      vaults[keyId] = {
        email,
        workspace,
        salt,
        verifier: await digestBase64(`${keyId}:${password}`),
        payload: await encryptState(key, freshState),
        createdAt: now(),
        updatedAt: now()
      };
      saveVaults(vaults);
      session = { vaultId: keyId, key, email, workspace };
      state = freshState;
    } else {
      const unlocked = await unlockVaultByEmail(vaults, email, password);
      if (!unlocked) throw new Error("No vault found for that email and password.");
      session = unlocked.session;
      state = unlocked.state;
    }

    selectedProjectId = state.projects[0]?.id || null;
    selectedEnvironmentId = getProject()?.environments[0]?.id || null;
    elements.authForm.reset();
    render();
    toast("Vault unlocked.");
  } catch (error) {
    toast(error.message);
  }
}

async function unlockVaultByEmail(vaults, email, password) {
  const matches = Object.entries(vaults).filter(([, vault]) => vault.email === email);

  for (const [keyId, vault] of matches) {
    const verifier = await digestBase64(`${keyId}:${password}`);
    if (verifier !== vault.verifier) continue;
    const key = await deriveKey(password, vault.salt);
    return {
      session: { vaultId: keyId, key, email, workspace: vault.workspace },
      state: await decryptState(key, vault.payload)
    };
  }

  return null;
}

function lock() {
  session = null;
  state = null;
  selectedProjectId = null;
  selectedEnvironmentId = null;
  editingKey = null;
  render();
}

function render() {
  const unlocked = Boolean(session && state);
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
    tab.className = `env-tab ${env.id === selectedEnvironmentId ? "active" : ""}`;
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

function renderVariables(environment) {
  elements.variableRows.innerHTML = "";
  if (!environment || sortedVariables(environment).length === 0) {
    elements.variableRows.innerHTML = `<tr><td colspan="4" class="masked">No variables yet.</td></tr>`;
    return;
  }

  sortedVariables(environment).forEach(([key, entry]) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code>${escapeHtml(key)}</code></td>
      <td class="masked">${"•".repeat(Math.min(String(entry.value).length || 6, 24))}</td>
      <td>${formatDate(entry.updatedAt)}</td>
      <td>
        <div class="row-actions">
          <button class="tiny" data-action="reveal" data-key="${escapeAttr(key)}" type="button">Reveal</button>
          <button class="tiny" data-action="edit" data-key="${escapeAttr(key)}" type="button">Edit</button>
          <button class="tiny" data-action="delete" data-key="${escapeAttr(key)}" type="button">Delete</button>
        </div>
      </td>
    `;
    elements.variableRows.append(row);
  });
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
    const result = parseDotEnv(text);
    if (result.entries.length === 0) {
      toast("No valid variables found in that file.");
      return;
    }

    const importedAt = now();
    snapshotEnvironment(environment, `Before import ${file.name}`);
    result.entries.forEach(([key, value]) => {
      environment.variables[key] = { value, updatedAt: importedAt };
    });

    await persist(`Imported ${result.entries.length} variables from ${file.name}.`);
    render();
  } catch (error) {
    toast(error.message || "Could not import .env file.");
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
  elements.promptDialog.showModal();
  elements.dialogInput.focus();

  return new Promise((resolve) => {
    const handler = () => {
      elements.promptDialog.removeEventListener("close", handler);
      resolve(elements.promptDialog.returnValue === "ok" ? elements.dialogInput.value.trim() : "");
    };
    elements.promptDialog.addEventListener("close", handler);
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

elements.loginTab.addEventListener("click", () => setAuthMode("login"));
elements.registerTab.addEventListener("click", () => setAuthMode("register"));
elements.authForm.addEventListener("submit", handleAuth);
elements.lockButton.addEventListener("click", lock);
elements.addProjectButton.addEventListener("click", createProject);
elements.addEnvButton.addEventListener("click", createEnvironment);
elements.deleteEnvButton.addEventListener("click", deleteEnvironment);
elements.deleteProjectButton.addEventListener("click", deleteProject);
elements.addVariableButton.addEventListener("click", () => showVariableForm());
elements.importEnvButton.addEventListener("click", () => elements.envFileInput.click());
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
    const value = environment.variables[key]?.value || "";
    navigator.clipboard?.writeText(value);
    toast("Value copied to clipboard.");
  }
});

elements.historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button?.dataset.action === "restore") restoreVersion(button.dataset.version);
});

setAuthMode("login");
render();
