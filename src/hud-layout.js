(function (root) {
  'use strict';

  function computeOverlapArea(a, b) {
    const overlapW = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    if (overlapW <= 0) return 0;
    const overlapH = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return overlapW * overlapH;
  }

  /**
   * Choose the best corner slot for the floating HUD so it avoids covering
   * the currently active/clicked input element (especially in bottom-right chat boxes).
   */
  function computeSmartHudPosition(options) {
    const viewportWidth = Math.max(200, Number(options.viewportWidth) || 0);
    const viewportHeight = Math.max(120, Number(options.viewportHeight) || 0);
    const hudWidth = Math.max(120, Number(options.hudWidth) || 326);
    const hudHeight = Math.max(36, Number(options.hudHeight) || 340);
    const margin = Number.isFinite(options.margin) ? options.margin : 16;
    const pad = Number.isFinite(options.pad) ? options.pad : 14;
    const targetRect = options.targetRect || null;

    const minLeft = margin;
    const minTop = margin;
    const maxLeft = Math.max(minLeft, viewportWidth - hudWidth - margin);
    const maxTop = Math.max(minTop, viewportHeight - hudHeight - margin);

    const candidates = [
      { corner: 'bottom-right', left: maxLeft, top: maxTop },
      { corner: 'bottom-left', left: minLeft, top: maxTop },
      { corner: 'top-right', left: maxLeft, top: minTop },
      { corner: 'top-left', left: minLeft, top: minTop }
    ];

    if (
      !targetRect ||
      !Number.isFinite(targetRect.left) ||
      !Number.isFinite(targetRect.top) ||
      (targetRect.width <= 0 && targetRect.height <= 0)
    ) {
      return candidates[0];
    }

    const protectedZone = {
      left: targetRect.left - pad,
      top: targetRect.top - pad,
      right: (Number.isFinite(targetRect.right) ? targetRect.right : targetRect.left + (targetRect.width || 0)) + pad,
      bottom: (Number.isFinite(targetRect.bottom) ? targetRect.bottom : targetRect.top + (targetRect.height || 0)) + pad
    };

    let best = candidates[0];
    let bestOverlap = Infinity;

    for (const candidate of candidates) {
      const hudBox = {
        left: candidate.left,
        top: candidate.top,
        right: candidate.left + hudWidth,
        bottom: candidate.top + hudHeight
      };
      const overlap = computeOverlapArea(hudBox, protectedZone);
      if (overlap === 0) {
        return candidate;
      }
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        best = candidate;
      }
    }

    return best;
  }

  const api = {
    computeOverlapArea,
    computeSmartHudPosition
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.MorseHudLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

