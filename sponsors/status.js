// Shared honest-status helper for sponsor adapters.
'use strict';
module.exports = function status(offDetail) {
  const st = { ok: false, detail: offDetail, error: '' };
  return {
    st,
    health: () => ({ ok: st.ok, detail: st.ok ? st.detail : st.error ? `off: ${st.error}` : st.detail }),
    fail: (msg) => { st.ok = false; st.error = String(msg).slice(0, 200); },
  };
};
