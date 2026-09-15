// core/services/TauriService.js
(function () {
  "use strict";

  window.TauriService = {
    // Accès "lazy" — on relit __TAURI__ à chaque fois
    get core() {
      return window.__TAURI__?.core || null;
    },
    get event() {
      return window.__TAURI__?.event || null;
    },
    get window() {
      return window.__TAURI__?.window || null;
    },
    get isAvailable() {
      return !!(window.__TAURI__?.core && window.__TAURI__?.event);
    },

    async invoke(command, args = {}) {
      if (!this.isAvailable) {
        console.warn(`⚠️ Tauri non disponible pour invoke("${command}")`);
        return null;
      }
      return await this.core.invoke(command, args);
    },

    async listen(eventName, callback) {
      if (!this.isAvailable) {
        console.warn(`⚠️ Tauri non disponible pour listen("${eventName}")`);
        return;
      }
      await this.event.listen(eventName, callback);
    },

    async emit(eventName, payload) {
      if (!this.isAvailable) {
        console.warn(`⚠️ Tauri non disponible pour emit("${eventName}")`);
        return;
      }
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
  };
})();
