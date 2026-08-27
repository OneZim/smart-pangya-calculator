// core/services/TauriService.js
(function () {
  "use strict";

  window.TauriService = {
    core: window.__TAURI__?.core || null,
    event: window.__TAURI__?.event || null,
    window: window.__TAURI__?.window || null,
    isAvailable: !!(window.__TAURI__?.core && window.__TAURI__?.event),

    async invoke(command, args = {}) {
      if (!this.isAvailable) {
        console.warn("⚠️ Tauri non disponible");
        return null;
      }
      return await this.core.invoke(command, args);
    },

    async listen(eventName, callback) {
      if (!this.isAvailable) return;
      await this.event.listen(eventName, callback);
    },

    async emit(eventName, payload) {
      if (!this.isAvailable) return;
      await this.event.emit(eventName, payload);
    },

    async getCurrentWindow() {
      if (!this.isAvailable) return null;
      return this.window.getCurrentWindow();
    },

    async setOverlayVisibility(overlayName, show) {
      return await this.invoke(`set_${overlayName}_visibility`, { show });
    },

    async setOverlayClickThrough(windowLabel, locked) {
      return await this.invoke("set_overlay_click_through", {
        windowLabel,
        locked,
      });
    },
    // core/services/TauriService.js

    async setOverlayClickThrough(windowLabel, locked) {
      return await this.invoke("set_overlay_click_through", {
        windowLabel,
        locked,
      });
    },
  };
})();
