/*
 * tst.add.js: tests computing values, given a set of data points
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('../../lib/ca/ca-common');
var mod_metric = require('../../lib/ca/ca-metric');
var mod_tl = require('../../lib/tst/ca-test');
var mod_cakstat = require('../../cmd/cainst/modules/kstat');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

var desc, metric;

desc = {
	module: 'disk',
	stat: 'disks',
	kstat: { class: 'disk' },
	extract: function (fields, ekstat, eklast, einterval) {
		return (1);
	},
	fields: {
		hostname: {
			values: function () { return ([ 'testhostname' ]); }
		},
		disk: {
			values: function (kstat) {
			    return ([ kstat['name'] ]);
			}
		},
		bytes_read: {
			bucketize: mod_cakstat.caMakeLogLinearBucketize(
			    10, 2, 11, 100),
			values: function (kstat, klast) {
				var after = kstat['data']['nread'];
				var before = klast['data']['nread'];
				return ([ after - before ]);
			}
		}
	}
};

var metadata = new mod_metric.caMetricMetadata();
metadata.addFromHost({
	modules: { 'disk': { label: 'Disk I/O' } },
	types: { number: { arity: 'numeric' } },
	fields: {
		hostname:	{ label: 'system name' },
		disk:		{ label: 'disk name' },
		bytes_read:	{ label: 'bytes read', type: 'number' }
	},
	metrics: [ {
		module: 'disk',
		stat: 'disks',
		label: 'disks',
		unit: 'disks',
		fields: [ 'hostname', 'disk', 'bytes_read' ]
	} ]
}, 'in-core');
mod_tl.ctStdout.info('%j', metadata);
ASSERT(metadata.problems().length === 0);

metric = new mod_cakstat.insKstatAutoMetric(desc, {
    is_module: desc['module'],
    is_stat: desc['stat'],
    is_predicate: {},
    is_decomposition: []
}, metadata);

var value, data;

data = [ {
    fields: { hostname: 'testhostname', disk: 'sd0', bytes_read: 1002 },
    value: 102
}, {
    fields: { hostname: 'testhostname', disk: 'sd1', bytes_read: 1002 },
    value: 101
}, {
    fields: { hostname: 'testhostname2', disk: 'sd1', bytes_read: 1001 },
    value: 100
} ];

value = metric.addDecompositions(data, [], 0);
mod_tl.ctStdout.dbg('value with no decomps = %j', value);
ASSERT(value === 303);

value = metric.addDecompositions(data, [ 'hostname' ], 0);
mod_tl.ctStdout.dbg('value with decomp by hostname = %j', value);
mod_assert.deepEqual({ 'testhostname': 203, 'testhostname2': 100 }, value);

value = metric.addDecompositions(data, [ 'disk' ], 0);
mod_tl.ctStdout.dbg('value with decomp by disk = %j', value);
mod_assert.deepEqual({ 'sd0': 102, 'sd1': 201 }, value);

value = metric.addDecompositions(data, [ 'bytes_read' ], 0);
mod_tl.ctStdout.dbg('value with decomp by bytes_read = %j', value);
mod_assert.deepEqual([[[1000, 1090], 303]], value);

value = metric.addDecompositions(data, [ 'hostname', 'disk' ], 0);
mod_tl.ctStdout.dbg('value with decomp by hostname and disk = %j', value);
mod_assert.deepEqual({ 'testhostname': { sd0: 102, sd1: 101 },
    'testhostname2': { sd1: 100 } }, value);

value = metric.addDecompositions(data, [ 'disk', 'bytes_read' ], 0);
mod_tl.ctStdout.dbg('value with decomp by disk and bytes_read = %j', value);
mod_assert.deepEqual({ 'sd0': [[[1000, 1090], 102 ]],
    'sd1': [[[1000, 1090], 201]] }, value);

process.exit(0);
