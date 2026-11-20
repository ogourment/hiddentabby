const groupsElement = document.querySelector("#groups");
const statusElement = document.querySelector("#status");
const windowCountElement = document.querySelector("#window-count");
const createForm = document.querySelector("#create-form");
const nameInput = document.querySelector("#group-name");
let stateLoadGeneration = 0;

async function sendCommand(type, values = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...values });
  if (!response?.ok) throw new Error(response?.error ?? "HiddenTabby could not complete that action.");
  return response.value;
}

function setStatus(message, kind = "info") {
  statusElement.textContent = message;
  statusElement.dataset.kind = kind;
}

function openGroupIds(state) {
  const ids = Array.isArray(state.openGroupIds) ? [...state.openGroupIds] : [];
  if (!ids.includes(state.activeGroupId)) ids.unshift(state.activeGroupId);
  return ids;
}

async function runGroupCommand(type, group, pending, done) {
  setStatus(pending);
  try {
    const result = await sendCommand(type, { groupId: group.id });
    await loadState({ preserveStatus: true });
    setStatus(result?.failures?.length ? result.failures.join(" ") : done, result?.failures?.length ? "error" : "info");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function makeGroupRow(group, state) {
  const open = openGroupIds(state);
  const isOpen = open.includes(group.id);
  const row = document.createElement("div");
  row.className = "group-row";
  row.dataset.open = String(isOpen);
  const main = makeGroupButton(group, state, isOpen);
  const toggle = document.createElement("label");
  toggle.className = "group-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isOpen;
  checkbox.disabled = isOpen && open.length === 1;
  toggle.title = isOpen
    ? (checkbox.disabled ? "This is the only open group." : `Untick to park ${group.name}; other open groups stay.`)
    : `Tick to open ${group.name} alongside the open groups.`;
  checkbox.setAttribute("aria-label", `${group.name} open`);
  checkbox.addEventListener("change", () => {
    checkbox.disabled = true;
    void (isOpen
      ? runGroupCommand("group:park", group, `Parking ${group.name}…`, `Parked ${group.name}.`)
      : runGroupCommand("group:open", group, `Opening ${group.name}…`, `Opened ${group.name} alongside the others.`));
  });
  toggle.append(checkbox);
  row.append(toggle, main);
  return row;
}

function makeGroupButton(group, state, isOpen) {
  const tabs = state.tabs.filter((tab) => tab.groupId === group.id);
  const openCount = tabs.filter((tab) => tab.status === "open").length;
  const savedCount = tabs.length - openCount;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "group-choice";
  button.setAttribute("aria-current", String(state.activeGroupId === group.id));
  button.title = `Show only ${group.name}; other groups are parked.`;
  const onlyOpen = isOpen && openGroupIds(state).length === 1;
  button.disabled = state.activeGroupId === group.id && onlyOpen && savedCount === 0;

  const nameWrap = document.createElement("span");
  nameWrap.className = "group-name-wrap";
  const dot = document.createElement("span");
  dot.className = "color-dot";
  dot.style.setProperty("--group-color", group.color);
  dot.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "group-name";
  name.textContent = group.name;
  nameWrap.append(dot, name);

  const meta = document.createElement("span");
  meta.className = "group-meta";
  const counts = savedCount ? `${openCount} open · ${savedCount} saved` : `${openCount} tab${openCount === 1 ? "" : "s"}`;
  meta.textContent = isOpen ? counts : `parked · ${tabs.length} saved`;
  button.append(nameWrap, meta);
  button.addEventListener("click", async () => {
    setStatus(state.activeGroupId === group.id && openGroupIds(state).length === 1
      ? "Restoring saved tabs…"
      : `Showing only ${group.name}…`);
    try {
      const result = await sendCommand("group:switch", { groupId: group.id });
      await loadState();
      setStatus(result.failures?.length ? result.failures.join(" ") : `Showing ${group.name}.`, result.failures?.length ? "error" : "info");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
  return button;
}

async function loadState({ preserveStatus = false } = {}) {
  const generation = ++stateLoadGeneration;
  try {
    const state = await sendCommand("state:get");
    if (generation !== stateLoadGeneration) return;
    const orderedGroups = [...state.groups].sort((a, b) => a.order - b.order);
    groupsElement.replaceChildren();
    for (const group of orderedGroups) groupsElement.append(makeGroupRow(group, state));
    const openWindows = state.windows.filter((window) => window.isOpen).length;
    windowCountElement.textContent = `${openWindows} window${openWindows === 1 ? "" : "s"}`;
    if (!preserveStatus) {
      setStatus("Tick the groups to keep open, or click a group to show only it. Unticked groups close their tabs; page state may not survive restoration.");
    }
  } catch (error) {
    if (generation !== stateLoadGeneration) return;
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Groups could not be loaded. Reload the extension and try again.";
    groupsElement.replaceChildren(empty);
    setStatus(error.message, "error");
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes["hiddentabby.state"]) {
    void loadState({ preserveStatus: true });
  }
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  setStatus("Creating group…");
  try {
    await sendCommand("group:create", { details: { name } });
    nameInput.value = "";
    await loadState();
    setStatus(`Created ${name}; your active group did not change.`);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.querySelector("#open-manager").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") });
});

void loadState();
