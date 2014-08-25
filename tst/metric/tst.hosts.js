/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

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
	set.addFromHost([ {
	    module: 'mod1',
	    stat: 'stat11',
	    fields: [ 'f1', 'f2' ]
	} ], 'host1');

	metric = set.baseMetric('mod1', 'stat11');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fields(), [ 'f1', 'f2' ]);
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
	set.addFromHost([ {
	    module: 'mod1',
	    stat: 'stat11',
	    fields: [ 'f2' ]
	} ], 'host2');

	metric = set.baseMetric('mod1', 'stat11');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fields(), [ 'f1', 'f2' ]);
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
	set.addFromHost([ {
	    module: 'mod1',
	    stat: 'stat11',
	    fields: [ 'f2', 'f4' ]
	} ], 'host4');

	metric = set.baseMetric('mod1', 'stat11');
	ASSERT(metric !== null);
	mod_assert.deepEqual(metric.fields(), [ 'f1', 'f2', 'f4' ]);
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
