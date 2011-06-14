/*
 * tst.value.js: tests computing kstat values
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('../../lib/ca/ca-common');
var mod_instr = require('../../lib/ca/ca-instr');
var mod_metric = require('../../lib/ca/ca-metric');
var mod_tl = require('../../lib/tst/ca-test');
var mod_cakstat = require('../../cmd/cainst/modules/kstat');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

var desc = {
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
			bucketize: mod_instr.caInstrLogLinearBucketize(
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

var instrbei = new mod_tl.caFakeInstrBackendInterface(metadata);

function make_metric(decomp)
{
	return (new mod_cakstat.insKstatAutoMetric(desc, {
		is_module: desc['module'],
		is_stat: desc['stat'],
		is_predicate: { ne: [ 'disk', 'sd1' ] },
		is_decomposition: decomp
	}, instrbei));
}

var metric_raw, metric_byhostname, metric_bydisk, metric_bybytes, metric_byboth;
var ndisks, key, sum;

metric_raw = make_metric([]);
metric_byhostname = make_metric(['hostname']);
metric_bydisk = make_metric(['disk']);
metric_bybytes = make_metric(['bytes_read']);
metric_byboth = make_metric(['bytes_read', 'disk']);

/*
 * Set up fake data.
 */
var metrics = [ metric_raw, metric_byhostname, metric_bydisk,
    metric_bybytes, metric_byboth ];
var ii;
for (ii = 0; ii < metrics.length; ii++) {
	metrics[ii].nreads = 0;
	metrics[ii].read = function ()
	{
		var val;

		this.nreads++;
		val = {
			'sd:0:disk:sd0': {
				class: 'disk',
				module: 'sd',
				name: 'sd0',
				instance: 0,
				snaptime: 59151171350139,
				data: { 'nread': this.nreads * 101 }
			},
			'sd:1:disk:sd1': {
				class: 'disk',
				module: 'sd',
				name: 'sd1',
				instance: 1,
				snaptime: 59151171350139,
				data: { 'nread': this.nreads * 102 }
			},
			'sd:2:disk:sd2': {
				class: 'disk',
				module: 'sd',
				name: 'sd2',
				instance: 2,
				snaptime: 59151171350139,
				data: { 'nread': this.nreads * 103 }
			}
		};

		mod_tl.ctStdout.dbg('read() returning %j', val);
		return (val);
	};
}

/*
 * First values should be all zeroes.
 */
mod_tl.ctStdout.info('initial values');

mod_tl.ctPushFunc(function () {
	metric_raw.value(function (value) {
		mod_assert.equal(value, 0);
		mod_tl.advance();
	});
});

mod_tl.ctPushFunc(function () {
	metric_byhostname.value(function (value) {
		mod_assert.deepEqual(value, {});
		mod_tl.advance();
	});
});

mod_tl.ctPushFunc(function () {
	metric_bydisk.value(function (value) {
		mod_assert.deepEqual(value, {});
		mod_tl.advance();
	});
});

mod_tl.ctPushFunc(function () {
	metric_bybytes.value(function (value) {
		mod_assert.deepEqual(value, []);
		mod_tl.advance();
	});
});

mod_tl.ctPushFunc(function () {
	metric_byboth.value(function (value) {
		mod_assert.deepEqual(value, {});
		mod_tl.advance();
	});
});

/*
 * Subsequent values should be known values.
 */
mod_tl.ctPushFunc(function () {
	metric_raw.value(function (value) {
		mod_tl.ctStdout.info('value raw: %j', value);
		ASSERT(value === 2);
		mod_tl.advance();
	});
});

mod_tl.ctPushFunc(function () {
	metric_byhostname.value(function (value) {
		mod_tl.ctStdout.info('value by hostname: %j', value);
		mod_assert.deepEqual(value, { 'testhostname': 2 });
		mod_tl.advance();
	});
});

mod_tl.ctPushFunc(function () {
	metric_bydisk.value(function (value) {
		mod_tl.ctStdout.info('value by disk: %j', value);
		mod_assert.deepEqual(value, { sd0: 1, sd2: 1 });
		mod_tl.advance();
	});
});

mod_tl.ctPushFunc(function () {
	metric_bybytes.value(function (value) {
		mod_tl.ctStdout.info('value by bytes: %j', value);
		mod_assert.deepEqual(value, [[[100, 109], 2]]);
		mod_tl.advance();
	});
});

mod_tl.ctPushFunc(function () {
	metric_byboth.value(function (value) {
		mod_tl.ctStdout.info('value by both: %j', value);
		mod_assert.deepEqual(value, {
			sd0: [[[100, 109], 1]],
			sd2: [[[100, 109], 1]]
		});
		mod_tl.advance();
	});
});

mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
