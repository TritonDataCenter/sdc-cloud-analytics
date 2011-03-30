/*
 * tst.read.js: tests the "read" phase of generating a kstat metric's value
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('../../lib/ca/ca-common');
var mod_tl = require('../../lib/tst/ca-test');
var mod_cakstat = require('../../cmd/cainst/modules/kstat');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

var desc, metric, kdata;

/*
 * Test 1: No filtering
 */
desc = {
	module: 'disk',
	stat: 'disks',
	kstat: { class: 'disk' },
	extract: function (fields, ekstat, eklast, einterval) {
		return (1);
	},
	fields: {
		hostname: {
			label: 'system name',
			type: mod_ca.ca_type_string,
			values: function () { return ([ 'testhostname' ]); }
		},
		disk: {
			label: 'disk name',
			type: mod_ca.ca_type_string,
			values: function (kstat) {
			    return ([ kstat['name'] ]);
			}
		}
	}
};

metric = new mod_cakstat.insKstatAutoMetric(desc, {
	is_module: desc['module'],
	is_stat: desc['stat'],
	is_predicate: {},
	is_decomposition: []
});

kdata = metric.read();
mod_tl.ctStdout.dbg('%j', kdata);
ASSERT(kdata instanceof Object);
ASSERT(!(kdata instanceof Array));

var key, parts, count, ncount;
count = 0;
for (key in kdata) {
	parts = key.split(/:/);
	ASSERT(parts[0] == kdata[key]['module']);
	ASSERT(parts[1] == kdata[key]['instance']);
	ASSERT(parts[2] == kdata[key]['class']);
	ASSERT(parts[3] == kdata[key]['name']);

	ASSERT(kdata[key]['class'] == 'disk');
	ASSERT('data' in kdata[key]);
	ASSERT('nread' in kdata[key]['data']);
	ASSERT('nwritten' in kdata[key]['data']);
	ASSERT('reads' in kdata[key]['data']);
	ASSERT('writes' in kdata[key]['data']);
	ASSERT('rtime' in kdata[key]['data']);
	ASSERT('wtime' in kdata[key]['data']);
	count++;
}

/*
 * Test 2: Filter by disk type
 */
var filter = {};
desc['filter'] = function (kstat) {
	if (!(filter[kstat['module']]))
		filter[kstat['module']] = 0;
	filter[kstat['module']]++;
	return (kstat['module'] == 'sd');
};

metric = new mod_cakstat.insKstatAutoMetric(desc, {
	is_module: desc['module'],
	is_stat: desc['stat'],
	is_predicate: {},
	is_decomposition: []
});

kdata = metric.read();
mod_tl.ctStdout.dbg('filter = %j', filter);
mod_tl.ctStdout.dbg('%j', kdata);

ncount = 0;
for (key in kdata) {
	parts = key.split(/:/);
	ASSERT(parts[0] == kdata[key]['module']);
	ASSERT(parts[1] == kdata[key]['instance']);
	ASSERT(parts[2] == kdata[key]['class']);
	ASSERT(parts[3] == kdata[key]['name']);

	ASSERT(kdata[key]['class'] == 'disk');
	ASSERT(kdata[key]['module'] == 'sd');
	ASSERT('data' in kdata[key]);
	ASSERT('nread' in kdata[key]['data']);
	ASSERT('nwritten' in kdata[key]['data']);
	ASSERT('reads' in kdata[key]['data']);
	ASSERT('writes' in kdata[key]['data']);
	ASSERT('rtime' in kdata[key]['data']);
	ASSERT('wtime' in kdata[key]['data']);
	ncount++;
}

ASSERT(ncount < count);
process.exit(0);
