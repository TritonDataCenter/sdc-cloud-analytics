/*
 * tst.intersect.js: tests intersecting metric sets
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_tl = require('../../lib/tst/ca-test');
var mod_md = require('../../lib/ca/ca-metadata');
var mod_metric = require('../../lib/ca/ca-metric');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

function metric_to_obj(metric)
{
	return ({
	    module: metric.module(),
	    stat: metric.stat(),
	    fields: metric.fields()
	});
}

/*
 * Checks intersection of one set based on input we'd get from the profile
 * consumer and input we'd get from instrumenters.
 */
function check_profile()
{
	var profset, instset, isectsetl, isectsetr, metricsl, metricsr;

	profset = new mod_metric.caMetricSet();
	profset.addMetric('mod1', 'stat1', [ 'f1', 'f2', 'f3' ]);
	profset.addMetric('mod1', 'stat2', []);
	profset.addMetric('mod2', 'stat1', [ 'f21', 'f22' ]);
	profset.addMetric('mod3', 'stat9', [ 'f21', 'f22' ]);

	instset = new mod_metric.caMetricSet();
	instset.addFromHost([ {
	    module: 'mod1',
	    stat: 'stat1',
	    label: 'stat 1',
	    unit: 'ops',
	    fields: [ 'f0', 'f1', 'f2', 'f3', 'f4' ]
	}, {
	    module: 'mod1',
	    stat: 'stat2',
	    label: 'stat 2',
	    unit: 'ops',
	    fields: [ 'f31' ]
	}, {
	    module: 'mod1',
	    stat: 'stat3',
	    label: 'stat 3',
	    unit: 'ops',
	    fields: [ 'f41' ]
	}, {
	    module: 'mod2',
	    stat: 'stat1',
	    label: 'stat 1',
	    unit: 'ops',
	    fields: [ 'f20', 'f21' ]
	}, {
	    module: 'mod2',
	    stat: 'stat1',
	    label: 'stat 1',
	    unit: 'ops',
	    fields: [ 'f20', 'f21' ]
	}, {
	    module: 'mod3',
	    stat: 'stat8',
	    label: 'stat 8',
	    unit: 'ops',
	    fields: [ 'f71' ]
	} ], 'test_host');

	/*
	 * Check commutativity.
	 */
	isectsetl = profset.intersection(instset);
	isectsetr = instset.intersection(profset);

	metricsl = isectsetl.baseMetrics().map(metric_to_obj);
	metricsr = isectsetr.baseMetrics().map(metric_to_obj);
	mod_assert.deepEqual(metricsl, metricsr);

	/*
	 * Check that the result is what we expect.
	 */
	mod_assert.deepEqual(metricsl, [ {
	    module: 'mod1',
	    stat: 'stat1',
	    fields: [ 'f1', 'f2', 'f3' ]
	}, {
	    module: 'mod1',
	    stat: 'stat2',
	    fields: []
	}, {
	    module: 'mod2',
	    stat: 'stat1',
	    fields: [ 'f21' ]
	} ]);

	mod_tl.advance();
}

mod_tl.ctPushFunc(check_profile);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
