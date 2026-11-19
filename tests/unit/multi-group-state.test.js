import test from "node:test";
import assert from "node:assert/strict";
import {
  assignTab,
  createFirstRunState,
  createGroup,
  deleteGroup,
  getOpenGroupIds,
  groupForWindow,
  handleWindowRemoved,
  moveTab,
  planGroupSwitch,
} from "../../src/group-state.js";

function idFactory() {
  let next = 0;
  return () => `id-${++next}`;
}

// Main is open in window 10. Ecojeux has one saved tab in a dormant window and
// A55ist has one saved tab in window 10.
function threeGroups() {
  const createId = idFactory();
  let state = createFirstRunState([
    { id: 1, windowId: 10, index: 0, url: "https://main.example/", title: "Main" },
  ], { createId });
  state = createGroup(state, { name: "Ecojeux", color: "green" }, { createId });
  state = createGroup(state, { name: "A55ist", color: "blue" }, { createId });
  const [main, ecojeux, a55ist] = state.groups.map((group) => group.id);
  const mainWindow = state.windows[0].id;
  state = {
    ...state,
    windows: [...state.windows, { id: "w-eco", browserWindowId: 20, isOpen: false, placeholderTabId: null, pinnedTabIds: [] }],
    tabs: [
      ...state.tabs,
      { id: "t-eco", browserTabId: null, browserWindowId: 20, windowId: "w-eco", groupId: ecojeux,
        url: "https://ecojeux.example/", title: "Ecojeux", faviconUrl: "", index: 0, lastActive: true,
        sessionId: null, status: "closed" },
      { id: "t-a55", browserTabId: null, browserWindowId: 10, windowId: mainWindow, groupId: a55ist,
        url: "https://a55ist.example/", title: "A55ist", faviconUrl: "", index: 1, lastActive: false,
        sessionId: null, status: "closed" },
    ],
  };
  return { state, main, ecojeux, a55ist };
}

test("legacy state without openGroupIds treats the active group as the only open group", () => {
  const { state, main } = threeGroups();
  const legacy = { ...state };
  delete legacy.openGroupIds;
  assert.deepEqual(getOpenGroupIds(legacy), [main]);
});

test("a plain switch stays exclusive: only the destination group remains open", () => {
  const { state, main, ecojeux } = threeGroups();
  const plan = planGroupSwitch(state, ecojeux);
  assert.deepEqual(plan.state.openGroupIds, [ecojeux]);
  assert.equal(plan.state.activeGroupId, ecojeux);
  assert.deepEqual(plan.closeTabs.map((tab) => tab.url), ["https://main.example/"]);
  assert.deepEqual(plan.restoreTabs.map((tab) => tab.id), ["t-eco"]);
  assert.ok(plan.closeWindowIds.includes(10), "Main's window closes when nothing open remains in it");
  assert.equal(getOpenGroupIds(plan.state).includes(main), false);
});

test("opening a group alongside keeps the current groups' tabs and windows open", () => {
  const { state, main, ecojeux } = threeGroups();
  const plan = planGroupSwitch(state, ecojeux, { keepOpenGroupIds: getOpenGroupIds(state) });
  assert.deepEqual(plan.state.openGroupIds, [ecojeux, main]);
  assert.equal(plan.state.activeGroupId, ecojeux);
  assert.deepEqual(plan.closeTabs, []);
  assert.deepEqual(plan.closeWindowIds, []);
  assert.deepEqual(plan.restoreTabs.map((tab) => tab.id), ["t-eco"]);
  assert.deepEqual(plan.recreateWindowIds, [20], "Ecojeux's dormant window is recreated");
});

test("parking closes only the parked group and keeps the others open", () => {
  const { state, main, ecojeux } = threeGroups();
  const opened = {
    ...planGroupSwitch(state, ecojeux, { keepOpenGroupIds: [main] }).state,
    tabs: state.tabs.map((tab) => tab.id === "t-eco" ? { ...tab, browserTabId: 2, status: "open" } : tab),
    windows: state.windows.map((window) => window.id === "w-eco" ? { ...window, isOpen: true } : window),
  };
  const plan = planGroupSwitch(opened, ecojeux, { keepOpenGroupIds: [ecojeux] });
  assert.deepEqual(plan.state.openGroupIds, [ecojeux]);
  assert.deepEqual(plan.closeTabs.map((tab) => tab.url), ["https://main.example/"]);
  assert.deepEqual(plan.closeWindowIds, [10]);
  assert.deepEqual(plan.restoreTabs, []);
});

test("re-planning the current layout with the same open groups is the classic no-change switch", () => {
  const { state, main } = threeGroups();
  const plan = planGroupSwitch(state, main, { keepOpenGroupIds: [main] });
  assert.deepEqual(plan.state.openGroupIds, [main]);
  assert.deepEqual(plan.closeTabs, []);
  assert.deepEqual(plan.closeWindowIds, []);
});

test("new tabs join the open group that owns their window, else the focused group", () => {
  const { state, main, ecojeux } = threeGroups();
  const both = {
    ...state,
    openGroupIds: [main, ecojeux],
    tabs: state.tabs.map((tab) => tab.id === "t-eco" ? { ...tab, browserTabId: 2, status: "open" } : tab),
  };
  assert.equal(groupForWindow(both, 20), ecojeux);
  assert.equal(groupForWindow(both, 10), main);
  assert.equal(groupForWindow(both, 99), both.activeGroupId);
  const created = assignTab(both, { id: 3, windowId: 20, url: "https://new.example/" }, groupForWindow(both, 20),
    { createId: idFactory() });
  assert.equal(created.tabs.find((tab) => tab.browserTabId === 3).groupId, ecojeux);
});

test("moving a tab to another open group keeps it open; to a parked group closes it", () => {
  const { state, main, ecojeux, a55ist } = threeGroups();
  const both = { ...state, openGroupIds: [main, ecojeux] };
  const mainTab = both.tabs.find((tab) => tab.groupId === main);
  const toOpen = moveTab(both, mainTab.id, ecojeux);
  assert.equal(toOpen.closeBrowserTab, null);
  assert.equal(toOpen.state.tabs.find((tab) => tab.id === mainTab.id).status, "open");
  const toParked = moveTab(both, mainTab.id, a55ist);
  assert.equal(toParked.closeBrowserTab, mainTab.browserTabId);
});

test("closing a window forgets open-group tabs in it but keeps parked snapshots", () => {
  const { state, main, a55ist } = threeGroups();
  const next = handleWindowRemoved(state, 10);
  assert.equal(next.tabs.some((tab) => tab.groupId === main), false);
  assert.ok(next.tabs.some((tab) => tab.groupId === a55ist), "Parked A55ist snapshot survives");
});

test("deleting the focused group focuses another open group and keeps it open", () => {
  const { state, main, ecojeux } = threeGroups();
  const focusedEco = { ...state, activeGroupId: ecojeux, openGroupIds: [ecojeux, main] };
  const result = deleteGroup(focusedEco, ecojeux);
  assert.equal(result.state.activeGroupId, main);
  assert.deepEqual(result.state.openGroupIds, [main]);
});
