// core/services/ShotInfoService.js
(function () {
  "use strict";

  window.ShotInfoService = {
    // === ÉTAT INTERNE ====================================================
    _state: {
      data: {}, // dernier payload update-ruler
      zoom: "80", // "80" ou "100"
      width: 1920, // résolution actuelle
      height: 1080, // résolution actuelle
      pxPerPb: 81, // px par PB pour zoom courant
      realPxPerPb: 72, // px par PB sur jauge réelle (calibré)
    },

    // === LISTENERS TAURI (stockés pour désabonnement) ====================
    _listeners: {},

    // === INITIALISATION ---------------------------------------------------
    /**
     * Initialise le service - idempotent
     * @param {Object} deps - { tauriService, storage }
     */
    async init(deps) {
      // Si déjà initialisé, ne rien faire
      if (this._initialized) return;

      const { tauriService, storage } = deps;
      if (!tauriService) {
        console.warn("[ShotInfoService] TauriService non disponible");
        return;
      }

      this._tauri = tauriService;
      this._storage = storage;

      // Charger la résolution actuelle
      try {
        const res = await tauriService.invoke("get_game_resolution");
        if (res?.width) {
          this._state.width = res.width;
          this._state.height = res.height || this._state.height;
        }
      } catch (err) {
        console.warn(
          "[ShotInfoService] Résolution non détectée, valeurs par défaut",
          err,
        );
      }

      // Charger le zoom depuis le storage (ruler_zoom = true => "100")
      if (storage) {
        await storage.init();
        const isZoomMax = storage.get("ruler_zoom", false);
        this._state.zoom = isZoomMax ? "100" : "80";
      }

      // Recalculer les valeurs dérivées
      this._recalculateDerived();

      // === POSITIONNER LES LISTENERS TAURI ==============================

      // Mise à jour des données de tir (pb, distance, percent)
      const unsubscribeData = tauriService.listen("update-ruler", (event) => {
        const payload = event.payload || {};
        this._state.data = payload;
        // Notifier les abonnés aux données
        this._notifyDataSubscribers(payload);
      });
      this._listeners["update-ruler"] = unsubscribeData;

      // Changement de zoom (Smart PB / PB Max)
      const unsubscribeZoom = tauriService.listen(
        "update-ruler-zoom",
        (event) => {
          const zoom = event.payload?.zoom === "100" ? "100" : "80";
          if (this._state.zoom !== zoom) {
            this._state.zoom = zoom;
            this._recalculateDerived();
            // Notifier les abonnés aux changements de config
            this._notifyConfigSubscribers();
          }
        },
      );
      this._listeners["update-ruler-zoom"] = unsubscribeZoom;

      // Changement de résolution du jeu
      const unsubscribeRes = tauriService.listen(
        "update-game-resolution",
        (event) => {
          const width = Number(event.payload?.width) || 0;
          const height = Number(event.payload?.height) || 0;
          if (
            width > 0 &&
            height > 0 &&
            (this._state.width !== width || this._state.height !== height)
          ) {
            this._state.width = width;
            this._state.height = height;
            this._recalculateDerived();
            // Notifier les abonnés aux changements de config
            this._notifyConfigSubscribers();
          }
        },
      );
      this._listeners["update-game-resolution"] = unsubscribeRes;

      this._initialized = true;
    },

    // === MÉTHODES PRIVÉES ================================================
    /**
     * Recalcule pxPerPb et realPxPerPb depuis la calibration
     */
    _recalculateDerived() {
      const calib = window.ResolutionCalibrationService?.getCalibration(
        this._state.width,
        this._state.height,
      );
      if (calib) {
        const ppb = calib?.pxPerPb || {};
        this._state.pxPerPb =
          ppb[this._state.zoom] != null
            ? ppb[this._state.zoom]
            : ppb["100"] != null
              ? ppb["100"]
              : 81; // DEFAULT_PX_PER_PB

        this._state.realPxPerPb = calib?.realPxPerPb || 72;
      } else {
        // Fallback si calibration service indisponible
        this._state.pxPerPb = 81;
        this._state.realPxPerPb = 72;
      }
    },

    // === NOTIFICATIONS AUX ABONNÉS ======================================
    _dataSubscribers: new Set(),
    _configSubscribers: new Set(),

    _notifyDataSubscribers(data) {
      this._dataSubscribers.forEach((cb) => cb(data));
    },

    _notifyConfigSubscribers() {
      this._configSubscribers.forEach((cb) => cb());
    },

    // === API PUBLIQUE ====================================================
    /**
     * Retourne les dernières données de tir reçues
     * @returns {Object} Dernier payload update-ruler
     */
    getCurrentData() {
      return { ...this._state.data };
    },

    /**
     * Retourne le zoom actuel ("80" ou "100")
     * @returns {"80"|"100"}
     */
    getCurrentZoom() {
      return this._state.zoom;
    },

    /**
     * Retourne la résolution actuelle
     * @returns {{width:number, height:number}}
     */
    getResolution() {
      return { width: this._state.width, height: this._state.height };
    },

    /**
     * Calcule et retourne pxPerPb pour la résolution/zoom courants
     * @returns {number} Pixels par PB
     */
    getPxPerPb() {
      return this._state.pxPerPb;
    },

    /**
     * Retourne realPxPerPb (px par PB sur la jauge réelle du joueur)
     * @returns {number}
     */
    getRealPxPerPb() {
      return this._state.realPxPerPb;
    },

    /**
     * Convertit une valeur PB brute en PB réel calibré
     * @param {number} pb - Valeur PB brute (peut être négative)
     * @returns {number} PB réel calibré
     */
    computeRealPb(pb) {
      if (pb == null) return 0;
      const pixelOffset = pb * this._state.pxPerPb;
      return pixelOffset / this._state.realPxPerPb;
    },

    /**
     * S'abonner aux changements de données de tir
     * @param {Function} callback - Fonction appelée avec les nouvelles données
     * @returns {Function} Fonction de désabonnement
     */
    onData(callback) {
      this._dataSubscribers.add(callback);
      // Retourner une fonction de désabonnement
      return () => this._dataSubscribers.delete(callback);
    },

    /**
     * S'abonner aux changements de configuration (zoom/résolution)
     * @param {Function} callback - Fonction appelée quand zoom/résolution change
     * @returns {Function} Fonction de désabonnement
     */
    onConfigChange(callback) {
      this._configSubscribers.add(callback);
      return () => this._configSubscribers.delete(callback);
    },

    // === NETTOYAGE (optionnel) ==========================================
    /**
     * Désabonne tous les listeners Tauri (utile en dev)
     */
    destroy() {
      Object.values(this._listeners).forEach((unsub) => {
        if (typeof unsub === "function") unsub();
      });
      this._listeners = {};
      this._dataSubscribers.clear();
      this._configSubscribers.clear();
      this._initialized = false;
    },
  };
})();
