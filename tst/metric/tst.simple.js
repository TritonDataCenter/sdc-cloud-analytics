/*
 * Tests basic caMetricSet and caMetric functionality.
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_tl = require('../../lib/tst/ca-test');
var mod_md = require('../../lib/ca/ca-metadata');
var mod_metric = require('../../lib/ca/ca-metric');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

var set, metric;

function setup()
{
	set = new mod_metric.caMetricSet();
	ASSERT(set.baseMetric('mod1', 'stat11') === null);
	ASSERT(set.baseMetric('mod1', 'stat12') === null);
	ASSERT(set.baseMetric('mod2', 'stat21') === null);
	ASSERT(set.baseMetric('mod3', 'stat31') === null);
	mod_tl.advance();
}

function simple()
{
	set.addMetric('mod1', 'stat11', [ 'f1', 'f2' ]);

	metric = set.baseMetric('mod1', 'stat11');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fields().sort(),
	    [ 'f1', 'f2' ]);

	ASSERT(set.baseMetric('mod1', 'stat12') === null);
	ASSERT(set.baseMetric('mod2', 'stat21') === null);
	ASSERT(set.baseMetric('mod3', 'stat31') === null);

	ASSERT(set.supports(metric, [ 'f1' ]));
	ASSERT(set.supports(metric, [ 'f2' ]));
	ASSERT(set.supports(metric, [ 'f1', 'f2' ]));
	ASSERT(set.supports(metric, [ 'f2', 'f1' ]));
	ASSERT(!set.supports(metric, [ 'f3' ]));
	ASSERT(!set.supports(metric, [ 'f1', 'f2', 'f3' ]));

	mod_tl.advance();
}

function add_stat()
{
	set.addMetric('mod1', 'stat12', [ 'f3' ]);

	metric = set.baseMetric('mod1', 'stat11');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fields().sort(), [ 'f1', 'f2' ]);

	metric = set.baseMetric('mod1', 'stat12');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fields().sort(), [ 'f3' ]);

	ASSERT(set.baseMetric('mod2', 'stat21') === null);
	ASSERT(set.baseMetric('mod3', 'stat31') === null);

	ASSERT(set.supports(metric, [ 'f3' ]));
	ASSERT(!set.supports(metric, [ 'f4' ]));

	mod_tl.advance();
}

function add_module()
{
	set.addMetric('mod3', 'stat31', []);

	metric = set.baseMetric('mod1', 'stat11');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fields().sort(),
	    [ 'f1', 'f2' ]);

	metric = set.baseMetric('mod1', 'stat12');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fields().sort(), [ 'f3' ]);

	metric = set.baseMetric('mod3', 'stat31');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fields(), []);
	ASSERT(set.baseMetric('mod2', 'stat21') === null);

	ASSERT(set.supports(metric, []));
	ASSERT(!set.supports(metric, [ 'f' ]));

	mod_tl.advance();
}

mod_tl.ctPushFunc(setup);
mod_tl.ctPushFunc(simple);
mod_tl.ctPushFunc(add_stat);
mod_tl.ctPushFunc(add_module);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
