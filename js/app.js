import { createClient, onLog, getLogs, clearLogs } from "./api.js";
import {
  escapeHtml,
  toast,
  confirmAction,
  openModal,
  formValue,
  checkedValues,
  spinner,
  emptyState,
  badge,
  locationName,
  isCallingLicense,
  personNumber,
} from "./ui.js";

const TOKEN_KEY = "wxc.token";
const CONNECTED_KEY = "wxc.connectedAt";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const state = {
  token: sessionStorage.getItem(TOKEN_KEY) || "",
  connectedAt: Number(sessionStorage.getItem(CONNECTED_KEY) || 0),
  me: null,
  orgId: "",
  orgName: "",
  locations: [],
  licenses: [],
  supportedDevices: [],
  cache: {},
};

const api = createClient(() => state.token);

const titles = {
  dashboard: "Dashboard",
  users: "Users",
  user: "User",
  devices: "Devices",
  locations: "Locations",
  numbers: "Numbers",
  workspaces: "Workspaces",
};

function remainingToken() {
  if (!state.connectedAt) return "Unknown remaining life";
  const ms = TOKEN_TTL_MS - (Date.now() - state.connectedAt);
  if (ms <= 0) return "Token likely expired";
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hrs}h ${mins}m remaining`;
}

function setSession(token) {
  state.token = token;
  state.connectedAt = Date.now();
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(CONNECTED_KEY, String(state.connectedAt));
}

function clearSession() {
  state.token = "";
  state.connectedAt = 0;
  state.me = null;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(CONNECTED_KEY);
}

function hashParts() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [page = "dashboard", id = ""] = raw.split("/");
  return { page: page || "dashboard", id: decodeURIComponent(id) };
}

function go(hash) {
  location.hash = hash;
}

async function loadLookups() {
  const orgId = state.orgId;
  const [locs, lics, devices] = await Promise.all([
    api.listLocations(orgId),
    api.listLicenses(orgId),
    api.supportedDevices(orgId).catch(() => ({ data: { devices: [] } })),
  ]);
  state.locations = locs.data.items || locs.data.locations || [];
  state.licenses = lics.data.items || [];
  state.supportedDevices = devices.data.devices || devices.data.items || [];
}

function phoneModels() {
  const list = state.supportedDevices.filter((d) => {
    const type = `${d.type || d.deviceType || ""} ${d.product || d.model || ""}`.toLowerCase();
    return type.includes("phone") || d.onboardingMethod || d.model;
  });
  const seen = new Set();
  return list.filter((d) => {
    const model = d.model || d.product;
    if (!model || seen.has(model)) return false;
    seen.add(model);
    return true;
  });
}

function locationOptions(selected = "") {
  return state.locations
    .map((l) => `<option value="${escapeHtml(l.id)}" ${l.id === selected ? "selected" : ""}>${escapeHtml(l.name)}</option>`)
    .join("");
}

function modelOptions() {
  const models = phoneModels();
  if (!models.length) {
    return `<option value="">Model (optional for RoomOS)</option>`;
  }
  return `<option value="">Select model</option>` + models
    .map((d) => `<option value="${escapeHtml(d.model)}">${escapeHtml(d.model)}${d.managedBy ? ` · ${escapeHtml(d.managedBy)}` : ""}</option>`)
    .join("");
}

function callingLicenseBoxes(selected = []) {
  const calling = state.licenses.filter(isCallingLicense);
  const list = calling.length ? calling : state.licenses;
  return list
    .map((lic) => {
      const checked = selected.includes(lic.id) || (!selected.length && isCallingLicense(lic)) ? "checked" : "";
      return `<label><input type="checkbox" name="licenses" value="${escapeHtml(lic.id)}" ${checked} /><span>${escapeHtml(lic.name)} <span class="muted">${lic.consumedUnits ?? 0}/${lic.totalUnits ?? "∞"}</span></span></label>`;
    })
    .join("");
}

function ownerLabel(item) {
  if (item.person?.displayName) return item.person.displayName;
  if (item.workspace?.displayName) return item.workspace.displayName;
  if (item.owner?.lastName || item.owner?.firstName) return [item.owner.firstName, item.owner.lastName].filter(Boolean).join(" ");
  if (item.owner?.displayName) return item.owner.displayName;
  return item.owner?.type || "Unassigned";
}

function numberOwner(n) {
  const owner = n.owner;
  if (!owner) return "Unassigned";
  return owner.lastName || owner.firstName
    ? [owner.firstName, owner.lastName].filter(Boolean).join(" ")
    : owner.displayName || owner.type || "Assigned";
}

function renderShell() {
  document.getElementById("app").hidden = false;
  document.getElementById("login-screen").hidden = true;
  document.getElementById("org-label").textContent = state.orgName || state.me?.emails?.[0] || "Connected";
  document.getElementById("session-meta").innerHTML = `
    ${escapeHtml(state.me?.displayName || "")}<br />
    ${escapeHtml(state.me?.emails?.[0] || "")}<br />
    ${escapeHtml(remainingToken())}
  `;
}

function renderLogin(error) {
  document.getElementById("app").hidden = true;
  document.getElementById("login-screen").hidden = false;
  const err = document.getElementById("login-error");
  if (error) {
    err.hidden = false;
    err.textContent = error;
  } else {
    err.hidden = true;
  }
}

async function connect(token) {
  const cleaned = token.replace(/^Bearer\s+/i, "").trim();
  if (!cleaned) throw new Error("Paste a personal access token.");
  state.token = cleaned;
  const { data: me } = await api.me();
  setSession(cleaned);
  state.me = me;
  state.orgId = me.orgId;
  try {
    const orgs = await api.listOrgs();
    const mine = (orgs.data.items || []).find((o) => o.id === me.orgId);
    state.orgName = mine?.displayName || me.orgId;
  } catch {
    state.orgName = me.orgId;
  }
  await loadLookups();
  renderShell();
  route();
}

async function route() {
  if (!state.token) {
    renderLogin();
    return;
  }
  if (!state.me) {
    try {
      await connect(state.token);
      return;
    } catch (err) {
      clearSession();
      renderLogin(err.message);
      return;
    }
  }

  renderShell();
  const { page, id } = hashParts();
  document.querySelectorAll(".nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === page || (page === "user" && a.dataset.route === "users"));
  });
  document.getElementById("page-title").textContent = titles[page] || "WxC Manager";
  document.getElementById("menu-toggle").onclick = () => document.querySelector(".sidebar").classList.toggle("open");
  document.querySelector(".sidebar")?.classList.remove("open");

  const content = document.getElementById("content");
  const actions = document.getElementById("topbar-actions");
  actions.innerHTML = "";
  content.innerHTML = spinner();

  try {
    if (page === "users") await renderUsers(content, actions);
    else if (page === "user") await renderUser(content, actions, id);
    else if (page === "devices") await renderDevices(content, actions);
    else if (page === "locations") await renderLocations(content, actions);
    else if (page === "numbers") await renderNumbers(content, actions);
    else if (page === "workspaces") await renderWorkspaces(content, actions);
    else await renderDashboard(content, actions);
  } catch (err) {
    content.innerHTML = emptyState("Request failed", err.message);
    toast(err.message, "error");
  }
}

async function renderDashboard(content, actions) {
  actions.innerHTML = `<a class="btn btn-primary" href="#/users">Provision user</a>`;
  const [people, devices, numbers] = await Promise.all([
    api.listPeople({ orgId: state.orgId, max: 1 }).catch(() => ({ data: { items: [] } })),
    api.listDevices({ orgId: state.orgId, max: 100 }).catch(() => ({ data: { items: [] } })),
    api.listNumbers({ orgId: state.orgId, max: 100 }).catch(() => ({ data: { phoneNumbers: [] } })),
  ]);
  const deviceItems = devices.data.items || [];
  const nums = numbers.data.phoneNumbers || numbers.data.items || [];
  const unassigned = nums.filter((n) => !n.owner).length;
  const callingLicenses = state.licenses.filter(isCallingLicense);
  const callingConsumed = callingLicenses.reduce((sum, l) => sum + (l.consumedUnits || 0), 0);

  content.innerHTML = `
    <div class="grid-stats">
      <article class="stat-card"><div class="label">Calling licenses in use</div><div class="value">${callingConsumed}</div></article>
      <article class="stat-card"><div class="label">Locations</div><div class="value">${state.locations.length}</div></article>
      <article class="stat-card"><div class="label">Devices (first 100)</div><div class="value">${deviceItems.length}</div></article>
      <article class="stat-card"><div class="label">Unassigned numbers</div><div class="value">${unassigned}</div></article>
    </div>
    <div class="split">
      <section class="panel">
        <h3>Calling licenses</h3>
        ${callingLicenses.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>License</th><th>Used</th><th>Total</th></tr></thead>
            <tbody>${callingLicenses.map((l) => `<tr><td>${escapeHtml(l.name)}</td><td>${l.consumedUnits ?? 0}</td><td>${l.totalUnits ?? "—"}</td></tr>`).join("")}</tbody>
          </table></div>` : `<p class="muted">No calling licenses visible with this token. Confirm the account is a full or calling admin.</p>`}
      </section>
      <section class="panel">
        <h3>Quick start</h3>
        <ol class="muted">
          <li>Provision a user with a Webex Calling license and location.</li>
          <li>Assign a DID or extension from Numbers.</li>
          <li>Add a phone by MAC address or generate an activation code.</li>
        </ol>
        <p class="muted">People list probe returned ${people.data.items?.length ?? 0} row(s). Use Users to search and manage the directory.</p>
      </section>
    </div>
  `;
}

async function renderUsers(content, actions) {
  actions.innerHTML = `
    <button class="btn" id="import-users">Import CSV</button>
    <button class="btn btn-primary" id="create-user">Provision user</button>
  `;
  content.innerHTML = `
    <div class="toolbar">
      <input id="user-search" placeholder="Search email or name" />
      <select id="user-location"><option value="">All locations</option>${locationOptions()}</select>
      <button class="btn" id="user-go">Search</button>
      <span class="spacer"></span>
      <span class="muted" id="user-count"></span>
    </div>
    <div id="user-table">${spinner("Search or load users…")}</div>
  `;

  const load = async () => {
    const q = document.getElementById("user-search").value.trim();
    const locationId = document.getElementById("user-location").value;
    const query = { orgId: state.orgId, max: 100, callingData: true };
    if (q.includes("@")) query.email = q;
    else if (q) query.displayName = q;
    if (locationId) query.locationId = locationId;
    document.getElementById("user-table").innerHTML = spinner();
    const { data } = await api.listPeople(query);
    const items = data.items || [];
    document.getElementById("user-count").textContent = `${items.length} shown`;
    if (!items.length) {
      document.getElementById("user-table").innerHTML = emptyState("No users", "Try a different search, or provision a new calling user.");
      return;
    }
    document.getElementById("user-table").innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Location</th><th>Number</th><th>Status</th></tr></thead>
        <tbody>
          ${items.map((p) => `
            <tr class="row-link" data-id="${escapeHtml(p.id)}">
              <td>${escapeHtml(p.displayName)}</td>
              <td>${escapeHtml(p.emails?.[0] || "")}</td>
              <td>${escapeHtml(locationName(state.locations, p.locationId))}</td>
              <td class="mono">${escapeHtml(personNumber(p))}</td>
              <td>${p.invitePending ? badge("Invite pending", "warn") : p.loginEnabled === false ? badge("Disabled", "danger") : badge("Active", "ok")}</td>
            </tr>`).join("")}
        </tbody>
      </table></div>`;
    document.querySelectorAll("#user-table tr[data-id]").forEach((row) => {
      row.addEventListener("click", () => go(`#/user/${encodeURIComponent(row.dataset.id)}`));
    });
  };

  document.getElementById("user-go").onclick = () => load().catch((e) => toast(e.message, "error"));
  document.getElementById("user-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") load().catch((err) => toast(err.message, "error"));
  });
  document.getElementById("create-user").onclick = () => showCreateUser();
  document.getElementById("import-users").onclick = () => showImportUsers();
  await load();
}

function showCreateUser() {
  openModal({
    title: "Provision calling user",
    confirmLabel: "Create",
    body: `
      <div class="form-grid">
        <div class="field"><label>Email</label><input name="email" type="email" required /></div>
        <div class="field"><label>Display name</label><input name="displayName" /></div>
        <div class="field"><label>First name</label><input name="firstName" /></div>
        <div class="field"><label>Last name</label><input name="lastName" /></div>
        <div class="field"><label>Location</label><select name="locationId">${locationOptions()}</select></div>
        <div class="field"><label>Extension (optional)</label><input name="extension" /></div>
      </div>
      <div class="field" style="margin-top:12px"><label>Licenses</label><div class="check-list">${callingLicenseBoxes()}</div></div>
    `,
    onConfirm: async (modal) => {
      const email = formValue(modal, "email");
      const firstName = formValue(modal, "firstName");
      const lastName = formValue(modal, "lastName");
      const displayName = formValue(modal, "displayName") || [firstName, lastName].filter(Boolean).join(" ") || email;
      const licenses = checkedValues(modal, "licenses");
      const locationId = formValue(modal, "locationId");
      const extension = formValue(modal, "extension");
      if (!email) throw new Error("Email is required.");
      if (!locationId) throw new Error("Choose a calling location.");
      if (!licenses.length) throw new Error("Select at least one license.");
      const { data } = await api.createPerson({
        emails: [email],
        displayName,
        firstName,
        lastName,
        orgId: state.orgId,
        licenses,
        locationId,
        ...(extension ? { extension } : {}),
      });
      toast(`Created ${data.displayName || email}`);
      go(`#/user/${encodeURIComponent(data.id)}`);
    },
  });
}

function showImportUsers() {
  openModal({
    title: "Import users from CSV",
    confirmLabel: "Import",
    body: `
      <p class="muted">Columns: <code>email,firstName,lastName,location,extension</code>. Location can be a name or location ID. One user is created per row.</p>
      <div class="field"><label>CSV</label><textarea name="csv" rows="10" placeholder="email,firstName,lastName,location,extension"></textarea></div>
    `,
    onConfirm: async (modal) => {
      const text = formValue(modal, "csv");
      const rows = parseCsv(text);
      if (!rows.length) throw new Error("No data rows found.");
      let ok = 0;
      const errors = [];
      for (const row of rows) {
        try {
          const locationId = resolveLocation(row.location);
          const licenses = state.licenses.filter(isCallingLicense).map((l) => l.id);
          await api.createPerson({
            emails: [row.email],
            firstName: row.firstName,
            lastName: row.lastName,
            displayName: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email,
            orgId: state.orgId,
            licenses: licenses.slice(0, 1),
            locationId,
            ...(row.extension ? { extension: row.extension } : {}),
          });
          ok += 1;
        } catch (err) {
          errors.push(`${row.email || "?"}: ${err.message}`);
        }
      }
      toast(`Imported ${ok}/${rows.length}`);
      if (errors.length) toast(errors.slice(0, 3).join(" | "), "error");
      route();
    },
  });
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const start = headers.includes("email") ? 1 : 0;
  return lines.slice(start).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    if (start === 0) {
      return { email: cols[0], firstName: cols[1], lastName: cols[2], location: cols[3], extension: cols[4] };
    }
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  }).filter((r) => r.email);
}

function resolveLocation(value) {
  if (!value) throw new Error("Location missing");
  const found = state.locations.find((l) => l.id === value || l.name.toLowerCase() === value.toLowerCase());
  if (!found) throw new Error(`Unknown location ${value}`);
  return found.id;
}

async function renderUser(content, actions, id) {
  if (!id) {
    content.innerHTML = emptyState("Missing user", "Go back to Users.");
    return;
  }
  const { data: person } = await api.getPerson(id);
  actions.innerHTML = `
    <a class="btn btn-ghost" href="#/users">Back</a>
    <button class="btn btn-danger" id="delete-user">Delete</button>
  `;

  const [numbers, devices, dnd, waiting, voicemail] = await Promise.all([
    api.personNumbers(id).catch(() => ({ data: null })),
    api.listDevices({ personId: id, orgId: state.orgId }).catch(() => ({ data: { items: [] } })),
    api.personDnd(id).catch(() => ({ data: null })),
    api.personCallWaiting(id).catch(() => ({ data: null })),
    api.personVoicemail(id).catch(() => ({ data: null })),
  ]);

  const primary = numbers.data?.primary || numbers.data || {};
  content.innerHTML = `
    <div class="split">
      <section class="panel">
        <h3>${escapeHtml(person.displayName || "")}</h3>
        <dl class="kv">
          <dt>Email</dt><dd>${escapeHtml(person.emails?.[0] || "")}</dd>
          <dt>Status</dt><dd>${person.invitePending ? badge("Invite pending", "warn") : badge("Active", "ok")}</dd>
          <dt>Org</dt><dd class="mono">${escapeHtml(person.orgId || "")}</dd>
        </dl>
        <form id="profile-form" class="stack" style="margin-top:14px">
          <div class="form-grid">
            <div class="field"><label>First name</label><input name="firstName" value="${escapeHtml(person.firstName || "")}" /></div>
            <div class="field"><label>Last name</label><input name="lastName" value="${escapeHtml(person.lastName || "")}" /></div>
            <div class="field"><label>Display name</label><input name="displayName" value="${escapeHtml(person.displayName || "")}" /></div>
            <div class="field"><label>Title</label><input name="title" value="${escapeHtml(person.title || "")}" /></div>
            <div class="field"><label>Location</label><select name="locationId">${locationOptions(person.locationId)}</select></div>
          </div>
          <div class="field"><label>Licenses</label><div class="check-list">${licenseBoxesForPerson(person)}</div></div>
          <button class="btn btn-primary" type="submit">Save profile</button>
        </form>
      </section>
      <div class="stack">
        <section class="panel">
          <h3>Calling number</h3>
          <form id="number-form" class="stack">
            <div class="field"><label>Primary DID (E.164)</label><input name="phoneNumber" value="${escapeHtml(primary.directNumber || primary.phoneNumber || "")}" placeholder="+4420..." /></div>
            <div class="field"><label>Extension</label><input name="extension" value="${escapeHtml(primary.extension || person.extension || "")}" /></div>
            <button class="btn" type="submit">Assign number</button>
          </form>
        </section>
        <section class="panel">
          <h3>Call features</h3>
          <form id="feat-form" class="stack">
            <label><input type="checkbox" name="dnd" ${dnd.data?.enabled ? "checked" : ""} /> Do not disturb</label>
            <label><input type="checkbox" name="waiting" ${waiting.data?.enabled !== false ? "checked" : ""} /> Call waiting</label>
            <label><input type="checkbox" name="voicemail" ${voicemail.data && voicemail.data.enabled !== false ? "checked" : ""} /> Voicemail enabled</label>
            <button class="btn" type="submit">Save features</button>
          </form>
        </section>
      </div>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="toolbar">
        <h3 style="margin:0">Devices</h3>
        <span class="spacer"></span>
        <button class="btn btn-primary" id="add-user-device">Add device</button>
      </div>
      ${deviceTable(devices.data.items || [])}
    </section>
  `;

  document.getElementById("delete-user").onclick = async () => {
    if (!(await confirmAction("Delete user", `Remove ${person.displayName} from the organization? This cannot be undone.`))) return;
    await api.deletePerson(id);
    toast("User deleted");
    go("#/users");
  };

  document.getElementById("profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const licenses = [...form.querySelectorAll("[name=licenses]:checked")].map((el) => el.value);
    try {
      const payload = {
        emails: person.emails,
        firstName: form.firstName.value.trim(),
        lastName: form.lastName.value.trim(),
        displayName: form.displayName.value.trim(),
        title: form.title.value.trim(),
        locationId: form.locationId.value || person.locationId,
        licenses,
        orgId: person.orgId,
        roles: person.roles,
        extension: person.extension,
        loginEnabled: person.loginEnabled,
        siteUrls: person.siteUrls,
      };
      Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
      await api.updatePerson(id, payload);
      toast("Profile saved");
      route();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  document.getElementById("number-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api.updatePersonNumbers(id, {
        phoneNumber: form.phoneNumber.value.trim() || undefined,
        extension: form.extension.value.trim() || undefined,
      });
      toast("Number assigned");
      route();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  document.getElementById("feat-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await Promise.all([
        api.updatePersonDnd(id, { enabled: form.dnd.checked, ringSplashEnabled: false }),
        api.updatePersonCallWaiting(id, { enabled: form.waiting.checked }),
        api.updatePersonVoicemail(id, {
          ...(voicemail.data || {}),
          enabled: form.voicemail.checked,
          sendToEmailEnabled: voicemail.data?.sendToEmailEnabled ?? false,
          notificationsEnabled: voicemail.data?.notificationsEnabled ?? false,
          sendAllCalls: voicemail.data?.sendAllCalls || { enabled: false },
          sendBusyCalls: voicemail.data?.sendBusyCalls || { enabled: true },
          sendUnansweredCalls: voicemail.data?.sendUnansweredCalls || { enabled: true, numberOfRings: 3 },
        }),
      ]);
      toast("Features saved");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  document.getElementById("add-user-device").onclick = () => showAddDevice({ personId: id, personName: person.displayName });
  bindDeviceRows();
}

function licenseBoxesForPerson(person) {
  const selected = person.licenses || [];
  return state.licenses
    .map((lic) => `<label><input type="checkbox" name="licenses" value="${escapeHtml(lic.id)}" ${selected.includes(lic.id) ? "checked" : ""} /><span>${escapeHtml(lic.name)}</span></label>`)
    .join("");
}

function deviceTable(items) {
  if (!items.length) return emptyState("No devices", "Add a phone by MAC address or generate an activation code.");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Product</th><th>MAC</th><th>Owner</th><th>Status</th><th></th></tr></thead>
    <tbody>${items.map((d) => `
      <tr>
        <td>${escapeHtml(d.displayName || d.product || "Device")}</td>
        <td>${escapeHtml(d.product || d.type || "")}</td>
        <td class="mono">${escapeHtml(d.mac || "—")}</td>
        <td>${escapeHtml(d.personDisplayName || d.workspaceName || ownerLabel(d))}</td>
        <td>${statusBadge(d.connectionStatus)}</td>
        <td><button class="btn btn-ghost" data-del-device="${escapeHtml(d.id)}">Remove</button></td>
      </tr>`).join("")}</tbody>
  </table></div>`;
}

function statusBadge(status) {
  const s = (status || "").toLowerCase();
  if (s === "connected") return badge("Connected", "ok");
  if (s === "disconnected") return badge("Disconnected", "danger");
  if (s.includes("connect")) return badge(status, "warn");
  return badge(status || "Unknown");
}

function bindDeviceRows() {
  document.querySelectorAll("[data-del-device]").forEach((btn) => {
    btn.onclick = async () => {
      if (!(await confirmAction("Remove device", "Delete this device from Webex Calling?"))) return;
      try {
        await api.deleteDevice(btn.dataset.delDevice);
        toast("Device removed");
        route();
      } catch (err) {
        toast(err.message, "error");
      }
    };
  });
}

function showAddDevice({ personId, workspaceId, personName, workspaceName } = {}) {
  openModal({
    title: "Add device",
    confirmLabel: "Provision",
    body: `
      <p class="muted">Assign to ${escapeHtml(personName || workspaceName || "a user or workspace")} using a MAC address (MPP/Desk phones) or an activation code (RoomOS and many phones).</p>
      <div class="form-grid">
        ${personId || workspaceId ? "" : `
          <div class="field"><label>Person ID or email search later — pick target type</label>
            <select name="targetType"><option value="person">User</option><option value="workspace">Workspace</option></select>
          </div>
          <div class="field"><label>Person or workspace ID</label><input name="targetId" /></div>
        `}
        <div class="field"><label>Method</label>
          <select name="method">
            <option value="mac">MAC address</option>
            <option value="code">Activation code</option>
          </select>
        </div>
        <div class="field"><label>Model</label><select name="model">${modelOptions()}</select></div>
        <div class="field"><label>MAC address</label><input name="mac" placeholder="001A2B3C4D5E" /></div>
      </div>
    `,
    onConfirm: async (modal) => {
      const method = formValue(modal, "method");
      const model = formValue(modal, "model");
      const body = {};
      if (personId) body.personId = personId;
      if (workspaceId) body.workspaceId = workspaceId;
      if (!personId && !workspaceId) {
        const type = formValue(modal, "targetType");
        const targetId = formValue(modal, "targetId");
        if (!targetId) throw new Error("Provide a person or workspace ID.");
        if (type === "workspace") body.workspaceId = targetId;
        else body.personId = targetId;
      }
      if (model) body.model = model;
      if (method === "mac") {
        const mac = formValue(modal, "mac").replace(/[^a-fA-F0-9]/g, "");
        if (mac.length !== 12) throw new Error("MAC address must be 12 hex characters.");
        body.mac = mac.toUpperCase();
        await api.createDeviceByMac(body);
        toast("Device created by MAC address");
        route();
      } else {
        const { data } = await api.activationCode(body);
        const code = data.code || data.activationCode || JSON.stringify(data);
        const expiry = data.expiryTime || data.expiresAt || "";
        setTimeout(() => {
          openModal({
            title: "Activation code",
            confirmLabel: "Copy and close",
            body: `<p class="muted">Enter this code on the device. ${expiry ? `Expires ${escapeHtml(String(expiry))}.` : ""}</p><div class="activation-code">${escapeHtml(code)}</div>`,
            onConfirm: async () => {
              try {
                await navigator.clipboard.writeText(String(code));
                toast("Activation code copied");
              } catch {
                toast(String(code));
              }
              route();
            },
          });
        }, 0);
      }
    },
  });
}

async function renderDevices(content, actions) {
  actions.innerHTML = `<button class="btn btn-primary" id="add-device">Add device</button>`;
  content.innerHTML = `
    <div class="toolbar">
      <input id="dev-search" placeholder="Display name or MAC" />
      <select id="dev-type">
        <option value="">All types</option>
        <option value="phone">Phones</option>
        <option value="roomdesk">Room / desk</option>
      </select>
      <select id="dev-status">
        <option value="">Any status</option>
        <option value="connected">Connected</option>
        <option value="disconnected">Disconnected</option>
      </select>
      <button class="btn" id="dev-go">Filter</button>
    </div>
    <div id="dev-table"></div>
  `;
  const load = async () => {
    const search = document.getElementById("dev-search").value.trim();
    const query = { orgId: state.orgId, max: 100 };
    if (document.getElementById("dev-type").value) query.productType = document.getElementById("dev-type").value;
    if (document.getElementById("dev-status").value) query.connectionStatus = document.getElementById("dev-status").value;
    if (/^[0-9a-fA-F:-]{12,17}$/.test(search)) query.mac = search.replace(/[^a-fA-F0-9]/g, "");
    else if (search) query.displayName = search;
    document.getElementById("dev-table").innerHTML = spinner();
    const { data } = await api.listDevices(query);
    document.getElementById("dev-table").innerHTML = deviceTable(data.items || []);
    bindDeviceRows();
  };
  document.getElementById("dev-go").onclick = () => load().catch((e) => toast(e.message, "error"));
  document.getElementById("add-device").onclick = () => showAddDevice({});
  await load();
}

async function renderLocations(content, actions) {
  actions.innerHTML = `<button class="btn btn-primary" id="create-location">Create location</button>`;
  if (!state.locations.length) await loadLookups();
  content.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Address</th><th>Time zone</th><th></th></tr></thead>
      <tbody>
        ${state.locations.map((l) => {
          const addr = l.address || {};
          const line = [addr.address1, addr.city, addr.postalCode, addr.country].filter(Boolean).join(", ");
          return `<tr>
            <td>${escapeHtml(l.name)}</td>
            <td>${escapeHtml(line || "—")}</td>
            <td>${escapeHtml(l.timeZone || "")}</td>
            <td><button class="btn btn-ghost" data-del-loc="${escapeHtml(l.id)}" data-name="${escapeHtml(l.name)}">Delete</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table></div>
  `;
  document.getElementById("create-location").onclick = () => {
    openModal({
      title: "Create location",
      confirmLabel: "Create",
      body: `
        <div class="form-grid">
          <div class="field"><label>Name</label><input name="name" required /></div>
          <div class="field"><label>Time zone</label><input name="timeZone" value="Europe/London" /></div>
          <div class="field"><label>Language</label><input name="preferredLanguage" value="en_GB" /></div>
          <div class="field"><label>Address line</label><input name="address1" /></div>
          <div class="field"><label>City</label><input name="city" /></div>
          <div class="field"><label>Postal code</label><input name="postalCode" /></div>
          <div class="field"><label>Country (ISO)</label><input name="country" value="GB" /></div>
        </div>
      `,
      onConfirm: async (modal) => {
        await api.createLocation({
          name: formValue(modal, "name"),
          timeZone: formValue(modal, "timeZone"),
          preferredLanguage: formValue(modal, "preferredLanguage"),
          address: {
            address1: formValue(modal, "address1"),
            city: formValue(modal, "city"),
            postalCode: formValue(modal, "postalCode"),
            country: formValue(modal, "country"),
          },
        });
        toast("Location created");
        await loadLookups();
        route();
      },
    });
  };
  document.querySelectorAll("[data-del-loc]").forEach((btn) => {
    btn.onclick = async () => {
      if (!(await confirmAction("Delete location", `Delete ${btn.dataset.name}? The location must be empty.`))) return;
      try {
        await api.deleteLocation(btn.dataset.delLoc);
        toast("Location deleted");
        await loadLookups();
        route();
      } catch (err) {
        toast(err.message, "error");
      }
    };
  });
}

async function renderNumbers(content, actions) {
  actions.innerHTML = `<button class="btn btn-primary" id="add-numbers">Add numbers</button>`;
  content.innerHTML = `
    <div class="toolbar">
      <select id="num-location"><option value="">All locations</option>${locationOptions()}</select>
      <select id="num-owner">
        <option value="">Any assignment</option>
        <option value="unassigned">Unassigned</option>
        <option value="assigned">Assigned</option>
      </select>
      <input id="num-search" placeholder="Number or extension" />
      <button class="btn" id="num-go">Filter</button>
    </div>
    <div id="num-table"></div>
  `;
  const load = async () => {
    const query = { orgId: state.orgId, max: 100 };
    const locationId = document.getElementById("num-location").value;
    const search = document.getElementById("num-search").value.trim();
    if (locationId) query.locationId = locationId;
    if (search.startsWith("+") || /\d{6,}/.test(search)) query.phoneNumber = search;
    else if (search) query.extension = search;
    document.getElementById("num-table").innerHTML = spinner();
    const { data } = await api.listNumbers(query);
    let items = data.phoneNumbers || data.items || [];
    const ownerFilter = document.getElementById("num-owner").value;
    if (ownerFilter === "unassigned") items = items.filter((n) => !n.owner);
    if (ownerFilter === "assigned") items = items.filter((n) => n.owner);
    if (!items.length) {
      document.getElementById("num-table").innerHTML = emptyState("No numbers", "Add DIDs to a location, or widen the filter.");
      return;
    }
    document.getElementById("num-table").innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Number</th><th>Extension</th><th>Location</th><th>Owner</th><th>State</th><th></th></tr></thead>
        <tbody>${items.map((n) => {
          const loc = n.location?.id || n.locationId;
          const phone = n.phoneNumber || n.number || "";
          return `<tr>
            <td class="mono">${escapeHtml(phone)}</td>
            <td>${escapeHtml(n.extension || "")}</td>
            <td>${escapeHtml(n.location?.name || locationName(state.locations, loc))}</td>
            <td>${escapeHtml(numberOwner(n))}</td>
            <td>${n.state === "ACTIVE" ? badge("Active", "ok") : badge(n.state || "Unknown", "warn")}</td>
            <td>
              <button class="btn btn-ghost" data-num-act="${escapeHtml(phone)}" data-loc="${escapeHtml(loc)}" data-state="${escapeHtml(n.state || "")}">${n.state === "ACTIVE" ? "Deactivate" : "Activate"}</button>
              <button class="btn btn-ghost" data-num-del="${escapeHtml(phone)}" data-loc="${escapeHtml(loc)}">Remove</button>
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`;

    document.querySelectorAll("[data-num-act]").forEach((btn) => {
      btn.onclick = async () => {
        const action = btn.dataset.state === "ACTIVE" ? "DEACTIVATE" : "ACTIVATE";
        try {
          await api.manageNumberState(btn.dataset.loc, { phoneNumbers: [btn.dataset.numAct], action }, state.orgId);
          toast(`${action === "ACTIVATE" ? "Activated" : "Deactivated"} ${btn.dataset.numAct}`);
          load();
        } catch (err) {
          toast(err.message, "error");
        }
      };
    });
    document.querySelectorAll("[data-num-del]").forEach((btn) => {
      btn.onclick = async () => {
        if (!(await confirmAction("Remove number", `Remove ${btn.dataset.numDel} from the location? It must be unassigned.`))) return;
        try {
          await api.removeNumbers(btn.dataset.loc, [btn.dataset.numDel], state.orgId);
          toast("Number removed");
          load();
        } catch (err) {
          toast(err.message, "error");
        }
      };
    });
  };
  document.getElementById("num-go").onclick = () => load().catch((e) => toast(e.message, "error"));
  document.getElementById("add-numbers").onclick = () => {
    openModal({
      title: "Add numbers to a location",
      confirmLabel: "Add",
      body: `
        <div class="stack">
          <div class="field"><label>Location</label><select name="locationId">${locationOptions()}</select></div>
          <div class="field"><label>Numbers (E.164, one per line)</label><textarea name="numbers" rows="6" placeholder="+442071234567"></textarea></div>
          <div class="field"><label>State</label>
            <select name="state"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
          </div>
        </div>
        <p class="muted">Adding numbers this way is for Local Gateway / non-integrated PSTN. Cisco Calling Plan numbers are typically assigned from Control Hub inventory.</p>
      `,
      onConfirm: async (modal) => {
        const locationId = formValue(modal, "locationId");
        const phoneNumbers = formValue(modal, "numbers").split(/\s+/).map((n) => n.trim()).filter(Boolean);
        if (!phoneNumbers.length) throw new Error("Enter at least one number.");
        await api.addNumbers(locationId, { phoneNumbers, state: formValue(modal, "state") }, state.orgId);
        toast(`Added ${phoneNumbers.length} number(s)`);
        route();
      },
    });
  };
  await load();
}

async function renderWorkspaces(content, actions) {
  actions.innerHTML = `<button class="btn btn-primary" id="create-ws">Create workspace</button>`;
  content.innerHTML = `
    <div class="toolbar">
      <input id="ws-search" placeholder="Workspace name" />
      <button class="btn" id="ws-go">Search</button>
    </div>
    <div id="ws-table"></div>
  `;
  const load = async () => {
    const query = { orgId: state.orgId, max: 100 };
    const q = document.getElementById("ws-search").value.trim();
    if (q) query.displayName = q;
    document.getElementById("ws-table").innerHTML = spinner();
    const { data } = await api.listWorkspaces(query);
    const items = data.items || [];
    if (!items.length) {
      document.getElementById("ws-table").innerHTML = emptyState("No workspaces", "Create a calling workspace for a shared area phone.");
      return;
    }
    document.getElementById("ws-table").innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Type</th><th>Calling</th><th>Location</th><th></th></tr></thead>
        <tbody>${items.map((w) => `
          <tr>
            <td>${escapeHtml(w.displayName)}</td>
            <td>${escapeHtml(w.type || "")}</td>
            <td>${escapeHtml(w.calling?.type || "")}</td>
            <td>${escapeHtml(locationName(state.locations, w.locationId || w.workspaceLocationId))}</td>
            <td>
              <button class="btn btn-ghost" data-ws-dev="${escapeHtml(w.id)}" data-name="${escapeHtml(w.displayName)}">Add device</button>
              <button class="btn btn-ghost" data-ws-del="${escapeHtml(w.id)}" data-name="${escapeHtml(w.displayName)}">Delete</button>
            </td>
          </tr>`).join("")}</tbody>
      </table></div>`;
    document.querySelectorAll("[data-ws-dev]").forEach((btn) => {
      btn.onclick = () => showAddDevice({ workspaceId: btn.dataset.wsDev, workspaceName: btn.dataset.name });
    });
    document.querySelectorAll("[data-ws-del]").forEach((btn) => {
      btn.onclick = async () => {
        if (!(await confirmAction("Delete workspace", `Delete ${btn.dataset.name}?`))) return;
        try {
          await api.deleteWorkspace(btn.dataset.wsDel);
          toast("Workspace deleted");
          load();
        } catch (err) {
          toast(err.message, "error");
        }
      };
    });
  };
  document.getElementById("ws-go").onclick = () => load().catch((e) => toast(e.message, "error"));
  document.getElementById("create-ws").onclick = () => {
    openModal({
      title: "Create workspace",
      confirmLabel: "Create",
      body: `
        <div class="form-grid">
          <div class="field"><label>Name</label><input name="displayName" required /></div>
          <div class="field"><label>Type</label>
            <select name="type">
              <option value="notSet">Not set</option>
              <option value="huddle">Huddle</option>
              <option value="conferenceRoom">Conference room</option>
              <option value="meetingRoom">Meeting room</option>
              <option value="open">Open</option>
            </select>
          </div>
          <div class="field"><label>Capacity</label><input name="capacity" type="number" value="1" min="1" /></div>
          <div class="field"><label>Calling location</label><select name="locationId">${locationOptions()}</select></div>
        </div>
      `,
      onConfirm: async (modal) => {
        const body = {
          displayName: formValue(modal, "displayName"),
          type: formValue(modal, "type"),
          capacity: Number(formValue(modal, "capacity") || 1),
          orgId: state.orgId,
          calling: { type: "webexCalling" },
          supportedDevices: "phones",
        };
        const locationId = formValue(modal, "locationId");
        if (locationId) body.locationId = locationId;
        await api.createWorkspace(body);
        toast("Workspace created");
        route();
      },
    });
  };
  await load();
}

function bindChrome() {
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("login-submit");
    btn.disabled = true;
    try {
      await connect(document.getElementById("token-input").value);
    } catch (err) {
      renderLogin(err.message);
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById("disconnect").onclick = () => {
    clearSession();
    renderLogin();
  };
  document.getElementById("open-log").onclick = () => {
    document.getElementById("log-drawer").hidden = false;
  };
  document.getElementById("close-log").onclick = () => {
    document.getElementById("log-drawer").hidden = true;
  };
  document.getElementById("clear-log").onclick = () => clearLogs();
  onLog((entries) => {
    document.getElementById("log-body").textContent = entries
      .map((e) => `${e.at}  ${e.method} ${e.status || "ERR"}  ${e.url}${e.note ? `  (${e.note})` : ""}`)
      .join("\n");
  });
  window.addEventListener("hashchange", route);
}

bindChrome();
route();
