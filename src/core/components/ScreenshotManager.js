// core/components/ScreenshotManager.js
(function () {
  "use strict";

  // Shared state per webview (each webview gets its own copy of this IIFE)
  const sharedState = {
    tauri: null,
    storage: null,
    folderPath: "",
    lastBase64: "",
    isFetching: false,
    tauriListenersAttached: false,
    views: new Set(), // each view: {imageElement, label, offsetXKey, offsetYKey, anchorKey, zoomKey}
  };

  function attachTauriListeners() {
    if (!sharedState.tauri || sharedState.tauriListenersAttached) return;
    sharedState.tauri.listen("nouvelle-capture-detectee", () => {
      if (!sharedState.folderPath) return;
      sharedState.triggerFetch();
    });
    sharedState.tauri.listen("screenshot-folder-changed", (event) => {
      const folderPath = event.payload?.folderPath;
      if (!folderPath) return;
      sharedState.folderPath = folderPath;
      sharedState.lastBase64 = "";
      sharedState.storage?.set("screenshot_folder", folderPath);
      sharedState.triggerFetch();
    });
    sharedState.tauriListenersAttached = true;
  }

  // Call this to acquire latest image (if needed) and distribute to views
  sharedState.triggerFetch = async function () {
    if (!sharedState.folderPath || !sharedState.tauri || sharedState.isFetching) return;
    sharedState.isFetching = true;
    try {
      const base64 = await sharedState.tauri.invoke("get_latest_image", {
        folderPath: sharedState.folderPath,
      });
      sharedState.lastBase64 = base64;
      // Distribute to all views
      for (const view of sharedState.views) {
        if (view.imageElement) {
          view.imageElement.src = base64;
          view.imageElement.onload = () => {
            view.applyCalibration?.();
          };
          view.imageElement.style.display = "block";
        }
        if (view.msgAttente) view.msgAttente.style.display = "none";
      }
      // Effacer les points de la balle si la fonction existe
      if (typeof window.resetBallDots === "function") {
        window.resetBallDots();
      }
    } catch (err) {
      console.error("❌ Erreur récupération image:", err);
    } finally {
      sharedState.isFetching = false;
    }
  };

  // Register a view (called from each factory instance)
  function registerView(options) {
    const {
      imageId = "wind-image",
      refreshBtnId = "btn-refresh-img",
      cropUpId = "btn-crop-up",
      cropDownId = "btn-crop-down",
      cropLeftId = "btn-crop-left",
      cropRightId = "btn-crop-right",
      offsetXKey = "imgOffsetX",
      offsetYKey = "imgOffsetY",
      anchorKey = "windAnchor",
      zoomKey = "windZoom",
      label = "vent",
    } = options;

    // Look up elements (they should exist in the DOM at this point)
    const imageElement = document.getElementById(imageId);
    const btnSelectFolder = document.getElementById("btn-select-folder");
    const inputFolderPath = document.getElementById("folder-path");
    const btnRefreshWind = document.getElementById(refreshBtnId);
    const btnClearFolder = document.getElementById("btn-clear-folder");
    const confirmModal = document.getElementById("custom-confirm-modal");
    const modalConfirmBtn = document.getElementById("modal-confirm-btn");
    const modalCancelBtn = document.getElementById("modal-cancel-btn");
    const msgAttente = document.getElementById("msg-attente");

    const view = {
      imageElement,
      label,
      offsetXKey,
      offsetYKey,
      anchorKey,
      zoomKey,
      msgAttente,
      // calibration and offsets specific to this view
      calibration: {},
      windImgOffsetX: 0,
      windImgOffsetY: 0,
      // methods that will be bound to this view
      applyCalibration: function () {
        if (!this.imageElement || !window.ResolutionCalibrationService) return;
        const w = this.imageElement.naturalWidth;
        const h = this.imageElement.naturalHeight;
        if (!w || !h) return;
        const calib = window.ResolutionCalibrationService.getCalibration(w, h);
        this.calibration = calib || {};
        this.updateWindImagePosition();
        console.log(
          "🖼️ Calibration " +
            this.label +
            ": image " +
            w +
            "x" +
            h +
            ' -> source "' +
            (calib._source || "") +
            '" (ancre ' +
            (calib[anchorKey]?.x ?? 0) +
            "," +
            (calib[anchorKey]?.y ?? 0) +
            ", zoom " +
            (calib[zoomKey] ?? 1) +
            ")"
        );
      },
      updateWindImagePosition: function () {
        if (!this.imageElement) return;
        const Z = this.calibration[zoomKey] || 1;
        const ax = this.calibration[anchorKey]?.x ?? 0;
        const ay = this.calibration[anchorKey]?.y ?? 0;
        const box = this.imageElement.parentElement;
        const cx = box ? box.clientWidth / 2 : 150;
        const cy = box ? box.clientHeight / 2 : 150;
        const tx = cx - ax * Z + this.windImgOffsetX;
        const ty = cy - ay * Z + this.windImgOffsetY;
        this.imageElement.style.transform =
          "translate(" + tx + "px, " + ty + "px) scale(" + Z + ")";
        sharedState.storage?.set(this.offsetXKey, this.windImgOffsetX);
        sharedState.storage?.set(this.offsetYKey, this.windImgOffsetY);
      },
    };

    // Initialize view with current state
    if (sharedState.folderPath && sharedState.lastBase64) {
      view.imageElement.src = sharedState.lastBase64;
      view.imageElement.onload = () => {
        view.applyCalibration();
      };
      view.imageElement.style.display = "block";
      if (view.msgAttente) view.msgAttente.style.display = "none";
    }

    // Register folder selection handler (shared across views, but we attach only once)
    if (btnSelectFolder && sharedState.tauri) {
      // Ensure we attach only once across all views
      if (!btnSelectFolder._listenerAttached) {
        btnSelectFolder.addEventListener("click", async () => {
          try {
            const selected = await sharedState.tauri.invoke("select_folder");
            if (!selected) return;
            sharedState.folderPath = selected;
            if (inputFolderPath) inputFolderPath.value = selected;
            sharedState.storage?.set("screenshot_folder", selected);
            await sharedState.tauri.emit("screenshot-folder-changed", {
              folderPath: selected,
            });
            const win = await sharedState.tauri.getCurrentWindow();
            if (win) await win.setFocus();
          } catch (err) {
            console.error("❌ Erreur select_folder:", err);
          }
        });
        btnSelectFolder._listenerAttached = true;
      }
    }

    // Register refresh button (per view)
    if (btnRefreshWind) {
      btnRefreshWind.addEventListener("click", () => {
        sharedState.triggerFetch();
      });
    }

    // Register crop buttons (per view - each view has its own offsets)
    const cropUpBtn = document.getElementById(cropUpId);
    const cropDownBtn = document.getElementById(cropDownId);
    const cropLeftBtn = document.getElementById(cropLeftId);
    const cropRightBtn = document.getElementById(cropRightId);

    if (cropUpBtn) {
      cropUpBtn.addEventListener("click", () => {
        view.windImgOffsetY -= 0.5;
        view.updateWindImagePosition();
      });
    }
    if (cropDownBtn) {
      cropDownBtn.addEventListener("click", () => {
        view.windImgOffsetY += 0.5;
        view.updateWindImagePosition();
      });
    }
    if (cropLeftBtn) {
      cropLeftBtn.addEventListener("click", () => {
        view.windImgOffsetX -= 0.5;
        view.updateWindImagePosition();
      });
    }
    if (cropRightBtn) {
      cropRightBtn.addEventListener("click", () => {
        view.windImgOffsetX += 0.5;
        view.updateWindImagePosition();
      });
    }

    // Register clear folder handler (shared across views, attach once)
    if (btnClearFolder && confirmModal && sharedState.tauri) {
      if (!btnClearFolder._listenerAttached) {
        btnClearFolder.addEventListener("click", () => {
          if (!sharedState.folderPath) {
            alert("Aucun dossier sélectionné.");
            return;
          }
          confirmModal.style.display = "flex";
        });
        modalCancelBtn?.addEventListener("click", () => {
          confirmModal.style.display = "none";
        });
        modalConfirmBtn?.addEventListener("click", async () => {
          confirmModal.style.display = "none";
          try {
            await sharedState.tauri.invoke("clear_screenshot_folder", {
              folderPath: sharedState.folderPath,
            });
            sharedState.lastBase64 = "";
            // Clear all views
            for (const v of sharedState.views) {
              if (v.imageElement) {
                v.imageElement.src = "";
                v.imageElement.style.display = "none";
              }
              if (v.msgAttente) v.msgAttente.style.display = "block";
            }
          } catch (err) {
            console.error("❌ Erreur nettoyage dossier:", err);
          }
        });
        btnClearFolder._listenerAttached = true;
      }
    }

    // Restore saved folder on startup (only need to do once)
    const savedFolder = sharedState.storage?.get("screenshot_folder", null);
    if (savedFolder && !sharedState.folderPath) {
      sharedState.folderPath = savedFolder;
      if (inputFolderPath) inputFolderPath.value = savedFolder;
      setTimeout(() => sharedState.triggerFetch(), 100);
    }

    // Add view to shared set
    sharedState.views.add(view);

    // Return the public API for this instance
    return {
      chargerDerniereImage: () => sharedState.triggerFetch(),
      updateWindImagePosition: () => {
        view.updateWindImagePosition();
      },
      setCalibration: (calib) => {
        view.calibration = calib || {};
        view.updateWindImagePosition();
      },
      get selectedFolderPath() {
        return sharedState.folderPath;
      },
    };
  }

  // The factory function now just calls registerView and returns its result
  window.ScreenshotManager = function (tauri, storage, options = {}) {
    // Initialize shared state on first call
    if (!sharedState.tauri) {
      sharedState.tauri = tauri;
      sharedState.storage = storage || window.StorageService || {
        get: (key, defaultValue) => defaultValue,
        set: () => {},
      };
      attachTauriListeners();
    }
    return registerView(options);
  };
})();