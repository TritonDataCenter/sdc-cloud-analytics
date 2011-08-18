/*
 * tst.format.js: tests caFormatDuration and friends
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');

var format = mod_ca.caFormatDuration;

mod_assert.equal(format(0), '00.000s');
mod_assert.equal(format(10), '00.010s');
mod_assert.equal(format(123), '00.123s');
mod_assert.equal(format(4123), '04.123s');
mod_assert.equal(format(64123), '01:04.123s');
mod_assert.equal(format(124123), '02:04.123s');
mod_assert.equal(format(3600000), '01:00:00.000s');
mod_assert.equal(format(3604123), '01:00:04.123s');
mod_assert.equal(format(3674123), '01:01:14.123s');
mod_assert.equal(format(25 * 3600000), '1 day 01:00:00.000s');
