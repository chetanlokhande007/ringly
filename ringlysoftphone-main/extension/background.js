// Ringly background service worker
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "ringly-call", title: "Call number with Ringly", contexts: ["selection", "link"] });
  chrome.contextMenus.create({ id: "ringly-sms", title: "Send SMS with Ringly", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "ringly-save", title: "Save contact to Ringly", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener((info) => {
  const number = (info.selectionText || info.linkUrl || "").replace(/[^\d+]/g, "");
  chrome.storage.local.set({ pendingAction: { type: info.menuItemId, number, at: Date.now() } });
  chrome.action.openPopup?.();
});

// Detect phone numbers on active tab (basic click-to-call scaffold)
chrome.action.onClicked.addListener(() => {
  chrome.action.openPopup?.();
});
