export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function h(strings, ...values) {
  return strings.reduce((out, part, i) => out + part + (i < values.length ? values[i] ?? "" : ""), "");
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function on(el, event, fn) {
  el.addEventListener(event, fn);
}

export function toast(message, kind = "ok") {
  const root = qs("#toast-root");
  const item = document.createElement("div");
  item.className = `toast ${kind}`;
  item.textContent = message;
  root.append(item);
  setTimeout(() => item.remove(), 4200);
}

export function confirmAction(title, body) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p>${escapeHtml(body)}</p>`,
      confirmLabel: "Confirm",
      danger: true,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export function openModal({ title, body, confirmLabel = "Save", danger = false, onConfirm, onCancel }) {
  const root = qs("#modal-root");
  root.hidden = false;
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <header>
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </header>
      <div class="body">${body}</div>
      <footer>
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${escapeHtml(confirmLabel)}</button>
      </footer>
    </div>`;

  const close = (result) => {
    root.hidden = true;
    root.innerHTML = "";
    if (result) onConfirm?.(root);
    else onCancel?.();
  };

  root.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => close(false)));
  root.querySelector("[data-confirm]").addEventListener("click", async () => {
    const btn = root.querySelector("[data-confirm]");
    btn.disabled = true;
    try {
      await onConfirm?.(root.querySelector(".modal"));
      if (!root.hidden) {
        root.hidden = true;
        root.innerHTML = "";
      }
    } catch (err) {
      btn.disabled = false;
      const existing = root.querySelector(".form-error");
      if (existing) existing.textContent = err.message;
      else {
        const p = document.createElement("p");
        p.className = "form-error";
        p.textContent = err.message;
        root.querySelector(".body").append(p);
      }
    }
  });
}

export function formValue(modal, name) {
  const field = modal.querySelector(`[name="${name}"]`);
  if (!field) return "";
  if (field.type === "checkbox") return field.checked;
  return field.value.trim();
}

export function checkedValues(modal, name) {
  return [...modal.querySelectorAll(`[name="${name}"]:checked`)].map((el) => el.value);
}

export function spinner(label = "Loading…") {
  return `<div class="empty">${escapeHtml(label)}</div>`;
}

export function emptyState(title, hint) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(hint)}</p></div>`;
}

export function badge(text, kind = "") {
  return `<span class="badge ${kind}">${escapeHtml(text)}</span>`;
}

export function locationName(locations, id) {
  return locations.find((l) => l.id === id)?.name || id || "—";
}

export function isCallingLicense(lic) {
  const name = `${lic.name || ""} ${lic.id || ""}`.toLowerCase();
  return name.includes("calling") || name.includes("webex voice") || name.includes("broadworks");
}

export function personNumber(person) {
  const numbers = person.phoneNumbers || [];
  const work = numbers.find((n) => n.type === "work") || numbers[0];
  return work?.value || person.extension || "—";
}

export function hasCalling(person) {
  return Boolean(person.locationId) || (person.licenses || []).some((id) => /calling|voice/i.test(id));
}
