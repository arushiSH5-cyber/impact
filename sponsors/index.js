// Sponsor adapters. Rule: health().ok is true only after a real call succeeded. No fake responses.
'use strict';
const llm = require('./llm');
const band = require('./band');
const telem = require('./telem');
const runware = require('./runware');
const glasser = require('./glasser');

const all = { llm, band, telem, runware, glasser };

module.exports = Object.assign({}, all, {
  async init() {
    await Promise.all(Object.entries(all).map(async ([name, a]) => {
      try { await a.init(); } catch (e) { a.fail(String(e.message || e)); console.log(`  ${name}: ${String(e.message || e).slice(0, 160)}`); }
    }));
  },
});
