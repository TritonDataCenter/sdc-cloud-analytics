/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * tst.error.js: tests errors from node-kstat
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('../../lib/ca/ca-common');
var mod_tl = require('../../lib/tst/ca-test');
var mod_cakstat = require('../../cmd/cainst/modules/kstat');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

var desc, metric, kdata, instrbei;

desc = {
	module: 'disk',
	stat: 'bytes_read',
	kstat: { class: 'disk' },
	extract: function (fields, ekstat, eklast, einterval) {
		return (ekstat['data']['nread']);
	},
	fields: {
		hostname: {
			values: function () { return ([ 'testhostname' ]); }
		},
		disk: {
			values: function (kstat) {
			    return ([ kstat['name'] ]);
			}
		}
	}
};

instrbei = new mod_tl.caFakeInstrBackendInterface();
metric = new mod_cakstat.insKstatAutoMetric(desc, {
	is_module: desc['module'],
	is_stat: desc['stat'],
	is_decomposition: []
}, instrbei);

metric.iam_reader.read = function ()
{
	var val = [ {
		class: 'disk',
		module: 'sd',
		name: 'sd0',
		instance: 0,
		snaptime: 59151171350139,
		data: { 'nread': 101 }
	}, {
		class: 'disk',
		module: 'sd',
		name: 'sd1',
		instance: 1,
		snaptime: 59151171350139,
		error: 'No such file or directory'
	}, {
		class: 'disk',
		module: 'sd',
		name: 'sd2',
		instance: 2,
		snaptime: 59151171350139,
		data: { 'nread': 103 }
	} ];

	mod_tl.ctStdout.dbg('read() returning %j', val);
	return (val);
};

metric.value(function (value) {
	mod_tl.ctStdout.dbg('value = %s', value);
	mod_assert.equal(value, 0);
	metric.value(function (nvalue) {
		mod_assert.equal(nvalue, 204);
		process.exit(0);
	});
});
