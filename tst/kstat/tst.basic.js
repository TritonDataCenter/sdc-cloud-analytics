/*
 * tst.basic.js: tests miscellaneous functionality of insKstatAutoMetric
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('../../lib/ca/ca-common');
var mod_tl = require('../../lib/tst/ca-test');
var mod_cakstat = require('../../cmd/cainst/modules/kstat');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

var desc, metric, kdata;

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

metric = new mod_cakstat.insKstatAutoMetric(desc, {
	is_module: desc['module'],
	is_stat: desc['stat'],
	is_predicate: { ne: [ 'disk', 'sd1' ] },
	is_decomposition: []
});

/*
 * Check that instrument() and deinstrument() invoke our callbacks.
 */
var invoked = 0;
metric.instrument(function () { invoked++; });
ASSERT(invoked == 1);
metric.deinstrument(function () { invoked++; });
ASSERT(invoked == 2);

/*
 * Check applyPredicate.  We do this by faking up "read" to return custom data.
 */
var nreads = 1;
metric.read = function ()
{
	var val;

	nreads++;
	val = {
		'sd:0:disk:sd0': {
			class: 'disk',
			module: 'sd',
			name: 'sd0',
			instance: 0,
			snaptime: 59151171350139,
			data: { 'nread': nreads * 101 }
		},
		'sd:1:disk:sd1': {
			class: 'disk',
			module: 'sd',
			name: 'sd1',
			instance: 1,
			snaptime: 59151171350139,
			data: { 'nread': nreads * 102 }
		},
		'sd:2:disk:sd2': {
			class: 'disk',
			module: 'sd',
			name: 'sd2',
			instance: 2,
			snaptime: 59151171350139,
			data: { 'nread': nreads * 103 }
		}
	};

	mod_tl.ctStdout.dbg('read() returning %j', val);
	return (val);
};

var value;

value = metric.value();
mod_tl.ctStdout.dbg('value = %s', value);
ASSERT(value === 0);

value = metric.value();
mod_tl.ctStdout.dbg('value = %s', value);
ASSERT(value === 612);

process.exit(0);
