/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

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
