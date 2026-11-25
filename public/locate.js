import { preciseLocation } from './registration-fields.js';

export function locateDevice(geolocation, onProgress, limit = 30_000) {
  return new Promise((resolve, reject) => {
    let watch;
    let finished = false;
    let retried = false;
    let best;
    const timeout = setTimeout(() => finish(reject, new Error(best == null ? 'location_signal_unavailable' : 'location_imprecise')), limit);

    function finish(callback, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (watch != null) geolocation.clearWatch(watch);
      callback(value);
    }
    function accept({ coords }) {
      if (finished) return;
      const { latitude, longitude, accuracy } = coords;
      if (Number.isFinite(accuracy) && accuracy > 0 && (best == null || accuracy < best)) {
        best = accuracy;
        onProgress?.(accuracy);
      }
      const location = { latitude, longitude, accuracy };
      if (preciseLocation(location)) finish(resolve, location);
    }
    const options = { enableHighAccuracy: true, maximumAge: 10_000, timeout: limit };
    function failed(error) {
      if (finished) return;
      if (error.code === 1) return finish(reject, new Error('location_permission'));
      if (!retried) {
        retried = true;
        try { geolocation.getCurrentPosition(accept, failed, options); }
        catch { /* Keep the active watch until the deadline. */ }
      }
    }
    try {
      watch = geolocation.watchPosition(accept, failed, options);
      if (finished && watch != null) geolocation.clearWatch(watch);
    } catch {
      try { geolocation.getCurrentPosition(accept, failed, options); }
      catch { finish(reject, new Error('location_signal_unavailable')); }
    }
  });
}
