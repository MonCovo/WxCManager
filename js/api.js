const BASE = "https://webexapis.com/v1";
const logs = [];
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(logs));
}

export function onLog(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLogs() {
  return logs;
}

export function clearLogs() {
  logs.length = 0;
  notify();
}

function parseLink(header) {
  if (!header) return {};
  const out = {};
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?([^"]+)"?/);
    if (match) out[match[2]] = match[1];
  }
  return out;
}

function errorMessage(payload, status, statusText) {
  if (!payload) return `${status} ${statusText}`.trim();
  if (typeof payload === "string") return payload;
  const nested = payload.errors?.map((e) => e.description || e.message).filter(Boolean) || [];
  const parts = [...new Set([payload.message, ...nested].filter(Boolean))];
  if (payload.trackingId) parts.push(`trackingId ${payload.trackingId}`);
  return parts.join(" — ") || `${status} ${statusText}`.trim();
}

export function createClient(getToken) {
  async function request(method, path, { query, body, headers, attempt = 0 } = {}) {
    const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
      });
    }

    const token = getToken();
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const started = Date.now();
    let status = 0;
    let payload = null;
    try {
      const res = await fetch(url, init);
      status = res.status;

      if (res.status === 429 && attempt < 4) {
        const retryAfter = Number(res.headers.get("Retry-After") || 1);
        await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter, 1), 15) * 1000));
        return request(method, path, { query, body, headers, attempt: attempt + 1 });
      }

      const text = await res.text();
      payload = text ? JSON.parse(text) : null;
      const entry = {
        at: new Date().toISOString(),
        method,
        url: url.toString().replace(token, "***"),
        status,
        ms: Date.now() - started,
        ok: res.ok,
      };
      logs.unshift(entry);
      if (logs.length > 80) logs.pop();
      notify();

      if (!res.ok) {
        const err = new Error(errorMessage(payload, res.status, res.statusText));
        err.status = res.status;
        err.payload = payload;
        throw err;
      }
      return { data: payload, links: parseLink(res.headers.get("Link")), status };
    } catch (err) {
      if (!err.status) {
        logs.unshift({
          at: new Date().toISOString(),
          method,
          url: url.toString(),
          status: status || 0,
          ms: Date.now() - started,
          ok: false,
          note: err.message,
        });
        notify();
        if (err.name === "TypeError") {
          throw new Error("Network or CORS failure talking to webexapis.com. Serve this app over HTTPS (GitHub Pages) or localhost, not as a file:// page.");
        }
      }
      throw err;
    }
  }

  const get = (path, query) => request("GET", path, { query });
  const post = (path, body, query) => request("POST", path, { body, query });
  const put = (path, body, query) => request("PUT", path, { body, query });
  const patch = (path, body, query) => request("PATCH", path, { body, query });
  const del = (path, query) => request("DELETE", path, { query });

  return {
    request,
    me: () => get("/people/me"),
    listPeople: (query) => get("/people", { max: 100, callingData: true, ...query }),
    listPeoplePage: async (query = {}) => {
      const { nextUrl, startIndex, max, ...rest } = query;
      const pageSize = Math.min(Number(max) || 100, 1000);
      const res = nextUrl
        ? await request("GET", nextUrl)
        : await get("/people", {
            max: pageSize,
            callingData: true,
            ...rest,
            ...(startIndex > 1 ? { startIndex } : {}),
          });
      const items = res.data?.items || [];
      return { items, next: res.links?.next || null, pageSize };
    },
    getPerson: (id) => get(`/people/${id}`, { callingData: true }),
    createPerson: (body) => post("/people", body, { callingData: true }),
    updatePerson: (id, body) => put(`/people/${id}`, body, { callingData: true }),
    deletePerson: (id) => del(`/people/${id}`),

    listLicenses: (orgId) => get("/licenses", { orgId }),
    listLocations: (orgId) => get("/locations", { orgId, max: 500 }),
    getLocation: (id) => get(`/locations/${id}`),
    createLocation: (body, orgId) => post("/locations", body, { orgId }),
    updateLocation: (id, body) => put(`/locations/${id}`, body),
    deleteLocation: (id) => del(`/locations/${id}`),

    listNumbers: (query) => get("/telephony/config/numbers", { max: 100, ...query }),
    addNumbers: (locationId, body, orgId) =>
      post(`/telephony/config/locations/${locationId}/numbers`, body, { orgId }),
    manageNumberState: (locationId, body, orgId) =>
      put(`/telephony/config/locations/${locationId}/numbers`, body, { orgId }),
    removeNumbers: (locationId, phoneNumbers, orgId) =>
      request("DELETE", `/telephony/config/locations/${locationId}/numbers`, {
        query: { orgId },
        body: { phoneNumbers },
      }),

    personNumbers: (personId) => get(`/people/${personId}/features/numbers`),
    updatePersonNumbers: (personId, body) => put(`/people/${personId}/features/numbers`, body),
    personCallerId: (personId) => get(`/people/${personId}/features/callerId`),
    updatePersonCallerId: (personId, body) => put(`/people/${personId}/features/callerId`, body),
    personForwarding: (personId) => get(`/people/${personId}/features/callForwarding`),
    updatePersonForwarding: (personId, body) => put(`/people/${personId}/features/callForwarding`, body),
    personVoicemail: (personId) => get(`/people/${personId}/features/voicemail`),
    updatePersonVoicemail: (personId, body) => put(`/people/${personId}/features/voicemail`, body),
    personCallWaiting: (personId) => get(`/people/${personId}/features/callWaiting`),
    updatePersonCallWaiting: (personId, body) => put(`/people/${personId}/features/callWaiting`, body),
    personDnd: (personId) => get(`/people/${personId}/features/doNotDisturb`),
    updatePersonDnd: (personId, body) => put(`/people/${personId}/features/doNotDisturb`, body),

    listDevices: (query) => get("/devices", { max: 100, ...query }),
    getDevice: (id) => get(`/devices/${id}`),
    deleteDevice: (id) => del(`/devices/${id}`),
    createDeviceByMac: (body) => post("/devices", body),
    activationCode: (body) => post("/devices/activationCode", body),
    supportedDevices: (orgId) => get("/telephony/config/supporteddevices", { orgId }),
    listLineKeyTemplates: (orgId) => get("/telephony/config/devices/lineKeyTemplates", { orgId }),
    getLineKeyTemplate: (templateId, orgId) =>
      get(`/telephony/config/devices/lineKeyTemplates/${encodeURIComponent(templateId)}`, { orgId }),
    getDeviceLayout: (deviceId, orgId) =>
      get(`/telephony/config/devices/${encodeURIComponent(deviceId)}/layout`, { orgId }),

    listWorkspaces: (query) => get("/workspaces", { max: 100, ...query }),
    getWorkspace: (id) => get(`/workspaces/${id}`),
    createWorkspace: (body) => post("/workspaces", body),
    updateWorkspace: (id, body) => put(`/workspaces/${id}`, body),
    deleteWorkspace: (id) => del(`/workspaces/${id}`),
    workspaceNumbers: (workspaceId) => get(`/workspaces/${workspaceId}/features/numbers`),
    updateWorkspaceNumbers: (workspaceId, body) => put(`/workspaces/${workspaceId}/features/numbers`, body),

    listOrgs: (query) => get("/organizations", query),
    getOrg: (id) => get(`/organizations/${id}`),
  };
}
