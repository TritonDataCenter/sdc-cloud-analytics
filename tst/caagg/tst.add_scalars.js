/*
 * Tests adding scalars using caAddScalar.
 */

var mod_assert = require('assert');
var mod_caagg = require('../../lib/ca/ca-agg');

mod_assert.equal(5, mod_caagg.caAddScalars(2, 3));
mod_assert.equal(0, mod_caagg.caAddScalars(0, 0));
mod_assert.equal(12, mod_caagg.caAddScalars(0, 12));
mod_assert.equal(12, mod_caagg.caAddScalars(12, 0));
