/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * tst.files_read.js: tests file read-related functions in caPersist
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_capersist = require('../../lib/ca/ca-persist');
var mod_tl = require('../../lib/tst/ca-test');
mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

var testdir = process.env['SRC'] + '/tst/persist';
var testfile = testdir + '/sample-ok.json';
var testfilebad = testdir + '/sample-bad.json';
var testfilenone = testdir + '/sample-nonexistent.json';

function readjson()
{
	mod_capersist.caReadFileJson(testfile, function (err, obj) {
		mod_assert.equal(err, null);

		mod_assert.deepEqual(obj, {
		    description: 'This is a JSON file used by the tests.',
		    problems: [ 'cable problem', 1 ]
		});

		mod_tl.advance();
	});
}

function badjson()
{
	mod_capersist.caReadFileJson(testfilebad, function (err, obj) {
		mod_assert.ok(err != null);
		mod_assert.equal(ECA_INVAL, err.code());
		mod_tl.advance();
	});
}

function badfile()
{
	mod_capersist.caReadFileJson(testfilenone, function (err, obj) {
		mod_assert.ok(err != null);
		mod_assert.equal(ECA_NOENT, err.code());
		mod_tl.advance();
	});
}

mod_tl.ctPushFunc(readjson);
mod_tl.ctPushFunc(badjson);
mod_tl.ctPushFunc(badfile);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
