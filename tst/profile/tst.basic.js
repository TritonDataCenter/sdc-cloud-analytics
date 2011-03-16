/*
 * tst.basic.js: tests basic profile manager behavior using existing (built-in)
 * profiles.  This test uses metadata contained within this test directory, not
 * the standard metadata shipped with our software.
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_tl = require('../../lib/tst/ca-test');
var mod_md = require('../../lib/ca/ca-metadata');
var mod_profile = require('../../lib/ca/ca-profile');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */
var mdmgr, profmgr;

function setup()
{
	mdmgr = new mod_md.caMetadataManager(mod_tl.ctStdout, '.');
	mdmgr.load(function (err) {
		if (err) {
			mod_tl.ctStdout.error('failed to load metadata: %r',
			    err);
			ASSERT(false);
		}

		mod_tl.advance();
	});
}

function check()
{
	var pp, set, metric;

	profmgr = new mod_profile.caProfileManager();
	profmgr.load(mdmgr);

	pp = profmgr.get('customer_test');
	ASSERT(pp.name() == 'customer_test');
	ASSERT(pp.label() == 'Customer_test');

	set = pp.metrics();
	metric = set.baseMetric('cpu', 'thread_executions');
	ASSERT(metric !== null);

	ASSERT(set.supports(metric, []));
	ASSERT(set.supports(metric, [ 'runtime' ]));
	ASSERT(set.supports(metric, [ 'runtime', 'pid' ]));
	ASSERT(!set.supports(metric, [ 'junk' ]));
	ASSERT(!set.supports(metric, [ 'runtime', 'pid', 'junk' ]));

	ASSERT(set.baseMetric('junk', 'thread_executions') === null);
	ASSERT(set.baseMetric('cpu', 'dunk') === null);

	metric = set.baseMetric('syscall', 'ops');
	ASSERT(metric !== null);

	ASSERT(!set.supports(metric, [ 'runtime', 'pid' ]));
	ASSERT(set.supports(metric, [ 'latency', 'execname' ]));

	ASSERT(profmgr.get('junk') === undefined);

	mod_tl.advance();
}

mod_tl.ctPushFunc(setup);
mod_tl.ctPushFunc(check);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
