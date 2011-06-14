/*
 * tst.datapoints.js: tests generating a list of data points from a pair of
 *     kstats, implemented by insKstatAutoMetric.kstatDataPoints().
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('../../lib/ca/ca-common');
var mod_tl = require('../../lib/tst/ca-test');
var mod_cakstat = require('../../cmd/cainst/modules/kstat');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

function setup(metric_desc)
{
	return (function () {
		metric = new mod_cakstat.insKstatAutoMetric(metric_desc, {
			is_module: metric_desc['module'],
			is_stat: metric_desc['stat'],
			is_predicate: {},
			is_decomposition: []
		}, new mod_tl.caFakeInstrBackendInterface());

		klast = metric.iam_reader.read();
		setTimeout(mod_tl.advance, 1000);
	});
}

var metric, klast, kdata, interval;

/*
 * The "simple" test verifies the easy case of having multiple
 * discretely-decomposed fields and a resource-type base metric.
 */
var simple_desc = {
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
		}
	}
};

function simple_check()
{
	var ii, datapts;

	kdata = metric.iam_reader.read();

	for (ii = 0; ii < kdata.length; ii++) {
		interval = kdata[ii]['snaptime'] - klast[ii]['snaptime'];
		ASSERT(interval > 1000000000);
		datapts = metric.kstatDataPoints(kdata[ii], klast[ii],
		    interval);
		mod_tl.ctStdout.info('datapts = %j', datapts);
		ASSERT(datapts.length == 1);
		ASSERT(datapts[0]['fields']['disk'] == kdata[ii]['name']);
		ASSERT(datapts[0]['fields']['hostname'] == 'testhostname');
		ASSERT(datapts[0]['value'] == 1);
	}

	mod_tl.advance();
}

mod_tl.ctPushFunc(setup(simple_desc));
mod_tl.ctPushFunc(simple_check);


/*
 * The "simple numeric" test verifies the case of decomposing simply by a
 * numeric field.
 */
var simple_numeric_desc = {
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
		bytes: {
			values: function (kst1, kst0, einterval) {
				return ([ kst1['data']['nread'] -
				    kst0['data']['nread'] ]);
			}
		}
	}
};

function simple_numeric_check()
{
	var ii, datapts;

	kdata = metric.iam_reader.read();

	for (ii = 0; ii < kdata.length; ii++) {
		interval = kdata[ii]['snaptime'] - klast[ii]['snaptime'];
		ASSERT(interval > 1000000000);
		datapts = metric.kstatDataPoints(kdata[ii], klast[ii],
		    interval);
		mod_tl.ctStdout.info('datapts = %j', datapts);
		ASSERT(datapts.length == 1);
		ASSERT(datapts[0]['fields']['disk'] == kdata[ii]['name']);
		ASSERT(datapts[0]['fields']['hostname'] == 'testhostname');
		ASSERT(datapts[0]['fields']['bytes'] ==
		    kdata[ii]['data']['nread'] - klast[ii]['data']['nread']);
		ASSERT(datapts[0]['value'] == 1);
	}

	mod_tl.advance();
}

mod_tl.ctPushFunc(setup(simple_numeric_desc));
mod_tl.ctPushFunc(simple_numeric_check);

/*
 * The "multivalue" test verifies the case of a single kstat generating multiple
 * data points (because a field has multiple values).  It also is our first test
 * with something that looks more like an operation than a resource.
 */
var multivalue_desc = {
	module: 'disk',
	stat: 'bytes',
	kstat: { class: 'disk' },
	extract: function (fields, ekstat, eklast, einterval) {
		var key = fields['optype'] + 's';
		return (ekstat['data'][key] - eklast['data'][key]);
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
		optype: {
			values: function () { return ([ 'read', 'write' ]); }
		}
	}
};

function multivalue_check()
{
	var ii, datapts;

	kdata = metric.iam_reader.read();

	for (ii = 0; ii < kdata.length; ii++) {
		interval = kdata[ii]['snaptime'] - klast[ii]['snaptime'];
		ASSERT(interval > 1000000000);
		datapts = metric.kstatDataPoints(kdata[ii], klast[ii],
		    interval);
		mod_tl.ctStdout.info('datapts = %j', datapts);
		ASSERT(datapts.length == 2);

		ASSERT(datapts[0]['fields']['disk'] == kdata[ii]['name']);
		ASSERT(datapts[0]['fields']['hostname'] == 'testhostname');
		ASSERT(datapts[0]['fields']['optype'] == 'read' ||
		    datapts[0]['fields']['optype'] == 'write');
		ASSERT(typeof (datapts[0]['value']) == 'number' &&
		    !isNaN(datapts[0]['value']));

		ASSERT(datapts[1]['fields']['disk'] == kdata[ii]['name']);
		ASSERT(datapts[1]['fields']['hostname'] == 'testhostname');
		ASSERT(datapts[1]['fields']['optype'] == 'read' ||
		    datapts[1]['fields']['optype'] == 'write');
		ASSERT(datapts[1]['fields']['optype'] !=
		    datapts[0]['fields']['optype']);
		ASSERT(typeof (datapts[1]['value']) == 'number' &&
		    !isNaN(datapts[1]['value']));
	}

	mod_tl.advance();
}

mod_tl.ctPushFunc(setup(multivalue_desc));
mod_tl.ctPushFunc(multivalue_check);

mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
