/*
 * tst.strings.js: test basic string functions
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common.js');

console.log('TEST: caStartsWith');
mod_assert.ok(caStartsWith('foobar', 'foo'));
mod_assert.ok(caStartsWith('foobar', 'foob'));
mod_assert.ok(!caStartsWith('foobar', 'food'));
mod_assert.ok(!caStartsWith('foobar', 'bar'));
mod_assert.ok(!caStartsWith('f', 'foo'));
mod_assert.ok(caStartsWith('foobar', ''));
mod_assert.ok(!caStartsWith('', 'foo'));
