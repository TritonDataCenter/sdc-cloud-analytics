/*
 * Tests caMetricSet and caMetric functionality when the source is data from an
 * instrumenter rather than a profile.
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_tl = require('../../lib/tst/ca-test');
var mod_md = require('../../lib/ca/ca-metadata');
var mod_metric = require('../../lib/ca/ca-metric');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

var set, metric;
var xform = mod_metric.caMetricsExpand;

function setup()
{
	set = new mod_metric.caMetricSet();
	ASSERT(set.baseMetric('mod1', 'stat11') === null);
	ASSERT(set.baseMetric('mod1', 'stat12') === null);
	ASSERT(set.baseMetric('mod2', 'stat21') === null);
	ASSERT(set.baseMetric('mod3', 'stat31') === null);
	mod_tl.advance();
}

/*
 * Add a single host with some fields.
 */
function check_basic()
{
	set.addFromHost(xform({
	    mod1: {
		label: 'module 1',
		stats: {
		    stat11: {
			type: 'ops',
			label: 'stat 11',
			fields: {
			    f1: { label: 'field1', type: 'string' },
			    f2: { label: 'field2', type: 'string' }
			}
		    }
		}
	    }
	}), 'host1');

	metric = set.baseMetric('mod1', 'stat11');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fieldTypes(),
	    { f1: 'string', f2: 'string' });
	ASSERT(set.baseMetric('mod1', 'stat12') === null);
	ASSERT(set.baseMetric('mod2', 'stat21') === null);
	ASSERT(set.baseMetric('mod3', 'stat31') === null);

	ASSERT(set.supports(metric, []));
	ASSERT(set.supports(metric, [ 'f1' ]));
	ASSERT(set.supports(metric, [ 'f2' ]));
	ASSERT(set.supports(metric, [ 'f1', 'f2' ]));
	ASSERT(set.supports(metric, [ 'f2', 'f1' ]));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f3' ]));
	ASSERT(!set.supports(metric, [ 'f3' ]));

	ASSERT(set.supports(metric, [], 'host1'));
	ASSERT(set.supports(metric, [ 'f1' ], 'host1'));
	ASSERT(set.supports(metric, [ 'f2' ], 'host1'));
	ASSERT(set.supports(metric, [ 'f1', 'f2' ], 'host1'));
	ASSERT(set.supports(metric, [ 'f2', 'f1' ], 'host1'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f3' ], 'host1'));
	ASSERT(!set.supports(metric, [ 'f3' ], 'host1'));

	ASSERT(!set.supports(metric, [], 'host3'));
	mod_tl.advance();
}

/*
 * Add another host with a more limited set of fields.
 */
function check_host2()
{
	set.addFromHost(xform({
	    mod1: {
		label: 'module 1',
		stats: {
		    stat11: {
			type: 'ops',
			label: 'stat 11',
			fields: {
			    f2: { label: 'field2', type: 'string' }
			}
		    }
		}
	    }
	}), 'host2');

	metric = set.baseMetric('mod1', 'stat11');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fieldTypes(),
	    { f1: 'string', f2: 'string' });
	ASSERT(set.baseMetric('mod1', 'stat12') === null);
	ASSERT(set.baseMetric('mod2', 'stat21') === null);
	ASSERT(set.baseMetric('mod3', 'stat31') === null);

	ASSERT(set.supports(metric, []));
	ASSERT(set.supports(metric, [ 'f1' ]));
	ASSERT(set.supports(metric, [ 'f2' ]));
	ASSERT(set.supports(metric, [ 'f1', 'f2' ]));
	ASSERT(set.supports(metric, [ 'f2', 'f1' ]));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f3' ]));
	ASSERT(!set.supports(metric, [ 'f3' ]));

	ASSERT(set.supports(metric, [], 'host1'));
	ASSERT(set.supports(metric, [ 'f1' ], 'host1'));
	ASSERT(set.supports(metric, [ 'f2' ], 'host1'));
	ASSERT(set.supports(metric, [ 'f1', 'f2' ], 'host1'));
	ASSERT(set.supports(metric, [ 'f2', 'f1' ], 'host1'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f3' ], 'host1'));
	ASSERT(!set.supports(metric, [ 'f3' ], 'host1'));

	ASSERT(set.supports(metric, [], 'host2'));
	ASSERT(!set.supports(metric, [ 'f1' ], 'host2'));
	ASSERT(set.supports(metric, [ 'f2' ], 'host2'));
	ASSERT(!set.supports(metric, [ 'f1', 'f2' ], 'host2'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1' ], 'host2'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f3' ], 'host2'));
	ASSERT(!set.supports(metric, [ 'f3' ], 'host2'));

	ASSERT(!set.supports(metric, [], 'host3'));
	mod_tl.advance();
}

/*
 * Extend the above metric with a new field, as though a new host came up which
 * supported a new field.
 */
function check_host3()
{
	set.addFromHost(xform({
	    mod1: {
		label: 'module 1',
		stats: {
		    stat11: {
			type: 'ops',
			label: 'stat 11',
			fields: {
			    f2: { label: 'field2', type: 'string' },
			    f4: { label: 'field4', type: 'string' }
			}
		    }
		}
	    }
	}), 'host4');

	metric = set.baseMetric('mod1', 'stat11');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fieldTypes(),
	    { f1: 'string', f2: 'string', f4: 'string' });
	ASSERT(set.baseMetric('mod1', 'stat12') === null);
	ASSERT(set.baseMetric('mod2', 'stat21') === null);
	ASSERT(set.baseMetric('mod3', 'stat31') === null);

	ASSERT(set.supports(metric, []));
	ASSERT(set.supports(metric, [ 'f1' ]));
	ASSERT(set.supports(metric, [ 'f2' ]));
	ASSERT(set.supports(metric, [ 'f1', 'f2' ]));
	ASSERT(set.supports(metric, [ 'f2', 'f1' ]));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f3' ]));
	ASSERT(!set.supports(metric, [ 'f3' ]));
	ASSERT(set.supports(metric, [ 'f2', 'f1', 'f4' ]));
	ASSERT(set.supports(metric, [ 'f4' ]));

	ASSERT(set.supports(metric, [], 'host1'));
	ASSERT(set.supports(metric, [ 'f1' ], 'host1'));
	ASSERT(set.supports(metric, [ 'f2' ], 'host1'));
	ASSERT(set.supports(metric, [ 'f1', 'f2' ], 'host1'));
	ASSERT(set.supports(metric, [ 'f2', 'f1' ], 'host1'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f3' ], 'host1'));
	ASSERT(!set.supports(metric, [ 'f3' ], 'host1'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f4' ], 'host1'));
	ASSERT(!set.supports(metric, [ 'f4' ], 'host1'));

	ASSERT(set.supports(metric, [], 'host2'));
	ASSERT(!set.supports(metric, [ 'f1' ], 'host2'));
	ASSERT(set.supports(metric, [ 'f2' ], 'host2'));
	ASSERT(!set.supports(metric, [ 'f1', 'f2' ], 'host2'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1' ], 'host2'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f3' ], 'host2'));
	ASSERT(!set.supports(metric, [ 'f3' ], 'host2'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f4' ], 'host2'));
	ASSERT(!set.supports(metric, [ 'f4' ], 'host2'));

	ASSERT(set.supports(metric, [], 'host4'));
	ASSERT(!set.supports(metric, [ 'f1' ], 'host4'));
	ASSERT(set.supports(metric, [ 'f2' ], 'host4'));
	ASSERT(!set.supports(metric, [ 'f1', 'f2' ], 'host4'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1' ], 'host4'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f3' ], 'host4'));
	ASSERT(!set.supports(metric, [ 'f3' ], 'host4'));
	ASSERT(!set.supports(metric, [ 'f2', 'f1', 'f4' ], 'host4'));
	ASSERT(set.supports(metric, [ 'f4' ], 'host4'));
	ASSERT(set.supports(metric, [ 'f2', 'f4' ], 'host4'));

	ASSERT(!set.supports(metric, [], 'host3'));
	mod_tl.advance();
}

mod_tl.ctPushFunc(setup);
mod_tl.ctPushFunc(check_basic);
mod_tl.ctPushFunc(check_host2);
mod_tl.ctPushFunc(check_host3);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
