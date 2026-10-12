(function (root) {
  function createState() {
    let imageState = "manual_only";
    let method = "manual_direct";
    let calibration = null;

    function clear(nextImageState) {
      imageState = nextImageState;
      method = "manual_direct";
      calibration = null;
    }

    return {
      imageLoaded() {
        clear("image_loaded");
      },
      imageReplacementStarted() {
        clear("manual_only");
      },
      imageRemoved() {
        clear("manual_only");
      },
      fileReadFailed() {
        clear("manual_only");
      },
      manualEntry(hasImage) {
        clear(hasImage ? "image_loaded" : "manual_only");
      },
      resetSelection() {
        clear(imageState === "manual_only" ? "manual_only" : "image_loaded");
      },
      calibrationCompleted(value) {
        const dishDiameterMm = Number(value && value.dishDiameterMm);
        const circleRadiusPx = Number(value && value.circleRadiusPx);
        const plateDiameterPx = Number(value && value.plateDiameterPx);
        if (
          imageState !== "image_loaded" ||
          !Number.isFinite(dishDiameterMm) ||
          dishDiameterMm <= 0 ||
          !Number.isFinite(circleRadiusPx) ||
          circleRadiusPx <= 4 ||
          !Number.isFinite(plateDiameterPx) ||
          plateDiameterPx <= 0
        )
          throw new Error("A valid loaded-image calibration is required");
        calibration = { dishDiameterMm, circleRadiusPx, plateDiameterPx };
        imageState = "calibrated_complete";
        method = "manual_local_image_calibrated";
      },
      dishDiameterChanged(value) {
        const next = Number(value);
        if (
          calibration &&
          (!Number.isFinite(next) || Math.abs(next - calibration.dishDiameterMm) > 0.000001)
        )
          clear("image_loaded");
      },
      snapshot() {
        return {
          imageState,
          method,
          calibration: calibration ? { ...calibration } : null,
        };
      },
    };
  }

  root.EchoClassMeasurementProvenance = { createState };
})(globalThis);
