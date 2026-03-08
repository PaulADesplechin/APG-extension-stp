// Chrome storage abstraction for processing history and settings
const StorageHelper = {
  async getHistory() {
    const data = await chrome.storage.local.get('processingHistory');
    return data.processingHistory || [];
  },

  async addToHistory(entry) {
    const history = await this.getHistory();
    history.push({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      ...entry
    });
    // Keep last 50 entries
    if (history.length > 50) history.splice(0, history.length - 50);
    await chrome.storage.local.set({ processingHistory: history });
    return history;
  },

  async getJob() {
    const data = await chrome.storage.local.get('currentJob');
    return data.currentJob || null;
  },

  async setJob(job) {
    await chrome.storage.local.set({ currentJob: job });
  },

  async clearJob() {
    await chrome.storage.local.remove('currentJob');
  },

  async getSettings() {
    const data = await chrome.storage.local.get('settings');
    return data.settings || {
      mockMode: true,
      delayBetweenRequests: 1000,
      lastIataColumn: '',
      lastCountryColumn: ''
    };
  },

  async saveSettings(settings) {
    const current = await this.getSettings();
    await chrome.storage.local.set({ settings: { ...current, ...settings } });
  }
};
