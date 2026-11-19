// Local agent bridge: lets a trusted local process (through a native-messaging
// host) list tabs and close tabs by ID. It exposes only "list" and "close";
// closing goes through the WorkspaceController so HiddenTabby's state stays
// consistent and pinned tabs are never closed.

export const AGENT_BRIDGE_HOST = "com.olivierg.hiddentabby_bridge";

function pickTab(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    url: tab.url ?? tab.pendingUrl ?? "",
    title: tab.title ?? "",
    pinned: Boolean(tab.pinned),
    active: Boolean(tab.active),
    audible: Boolean(tab.audible),
    discarded: Boolean(tab.discarded),
    groupId: tab.groupId,
    lastAccessed: tab.lastAccessed ?? null,
  };
}

function pickRecord(record) {
  return {
    id: record.id,
    groupId: record.groupId,
    status: record.status,
    browserTabId: record.browserTabId ?? null,
    url: record.url ?? "",
    title: record.title ?? "",
  };
}

export function createAgentBridgeHandler(chromeApi, controller) {
  const operations = {
    async list() {
      const windows = await chromeApi.windows.getAll({ populate: true, windowTypes: ["normal"] });
      const tabs = windows
        .filter((window) => !window.incognito)
        .flatMap((window) => (window.tabs ?? []).filter((tab) => !tab.incognito).map(pickTab));
      const state = await controller.getState();
      return {
        tabs,
        groups: (state.groups ?? []).map(({ id, name, color }) => ({ id, name, color })),
        activeGroupId: state.activeGroupId ?? null,
        records: (state.tabs ?? []).map(pickRecord),
      };
    },

    async close(message) {
      const ids = Array.isArray(message.tabIds) ? message.tabIds : [];
      const valid = ids.filter((id) => Number.isInteger(id) || (typeof id === "string" && id));
      if (!valid.length) throw new Error("close requires a non-empty tabIds array.");
      const results = [];
      for (const id of valid) {
        try {
          await controller.deleteTab(id);
          results.push({ id, ok: true });
        } catch (error) {
          results.push({ id, ok: false, error: error.message });
        }
      }
      return { results };
    },
  };

  return async (message) => {
    const operation = operations[message?.op];
    if (!operation) return { id: message?.id, ok: false, error: `Unknown op: ${message?.op}` };
    try {
      return { id: message.id, ok: true, value: await operation(message) };
    } catch (error) {
      return { id: message.id, ok: false, error: error.message };
    }
  };
}

export function connectAgentBridge(chromeApi, controller, { setTimer = setTimeout } = {}) {
  if (!chromeApi?.runtime?.connectNative) return;
  const handle = createAgentBridgeHandler(chromeApi, controller);
  let delay = 5_000;

  const connect = () => {
    let port;
    try {
      port = chromeApi.runtime.connectNative(AGENT_BRIDGE_HOST);
    } catch (error) {
      console.warn("HiddenTabby agent bridge unavailable:", error);
      return;
    }
    port.onMessage.addListener(async (message) => {
      delay = 5_000;
      const response = await handle(message);
      try {
        port.postMessage(response);
      } catch (error) {
        console.warn("HiddenTabby agent bridge reply failed:", error);
      }
    });
    port.onDisconnect.addListener(() => {
      void chromeApi.runtime.lastError;
      setTimer(connect, delay);
      delay = Math.min(delay * 2, 300_000);
    });
  };

  connect();
}
