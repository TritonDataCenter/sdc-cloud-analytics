/*
 * tst.svc.js: tests the instrumenter service.
 */

var mod_assert = require('assert');

var mod_metric = require('../../lib/ca/ca-metric');
var mod_svc = require('../../lib/ca/ca-svc-instr');
var mod_tl = require('../../lib/tst/ca-test');

var svc, mod1, mod2, cap, before;
var instn1id = 'global;17';
var instn2id = 'global;34';
var instn1key = 'ca.instrumentation.' + instn1id;
var instn2key = 'ca.instrumentation.' + instn2id;
var zones = [ 'zone1', 'zone2' ];

var expected_mod1 = 0;
var expected_mod2 = 0;
var expected_metrics = [];
var received_datapoints = [];

mod_tl.ctSetTimeout(15 * 1000);

function setup_svc()
{
	svc = new mod_svc.caInstrService([ process.env['SRC'] + '/metadata' ],
	    process.stdout,
	    [ '../../../tst/instr/testmod1', '../../../tst/instr/testmod2' ]);

	svc.start(function (err) {
		if (err)
			throw (err);

		mod_tl.advance();
	});
}

function setup_cap()
{
	cap = mod_tl.ctCreateCap({
	    type: 'config',
	    bind: [ instn1key, instn2key ]
	});

	cap.on('msg-data', function (msg) {
		received_datapoints.push(msg);
	});

	cap.on('connected', mod_tl.advance);
	cap.start();
}

function setup_fini()
{
	/*
	 * This is a little sneaky.  We're relying on the fact that node caches
	 * required modules to make sure that we get the same instance that the
	 * instrumenter did.
	 */
	mod1 = require('./testmod1');
	mod2 = require('./testmod2');

	mod_assert.equal(mod1.ninstns, 0);
	mod_assert.deepEqual(mod1.metrics, []);

	mod_assert.equal(mod2.ninstns, 0);
	mod_assert.deepEqual(mod2.metrics, []);

	before = new Date().getTime();

	mod_tl.advance();
}

function enable_mod1(instnid, instnkey, expect_increment)
{
	var props;

	props = {
		module: mod1.metric.module(),
		stat: mod1.metric.stat(),
		predicate: {},
		decomposition: [],
		granularity: 1
	};

	if (expect_increment) {
		expected_mod1++;
		expected_metrics.push({
			is_backend: '../../../tst/instr/testmod1',
			is_fqid: instnid,
			is_granularity: 1,
			is_module: props['module'],
			is_stat: props['stat'],
			is_predicate: {},
			is_decomposition: [],
			is_zones: zones
		});
	}

	cap.cmdEnableInst(svc.routekey(), instnid, instnkey, props, zones,
	    250, function (err) {
		if (err)
			console.error('error: %s (%j)', err.message, err);
		mod_assert.ok(!err);

		mod_assert.equal(mod1.ninstns, expected_mod1);
		mod_assert.deepEqual(mod1.metrics, expected_metrics);

		mod_assert.equal(mod2.metrics.length, expected_mod2);
		mod_assert.equal(mod2.ninstns, expected_mod2);

		mod_tl.advance();
	});
}

function enable_mod2(instnid, instnkey, expected_increment)
{
	var props = {
		module: mod2.metric.module(),
		stat: mod2.metric.stat(),
		predicate: {},
		decomposition: [ mod2.metric.fields()[0] ],
		granularity: 1
	};

	expected_mod2++;

	cap.cmdEnableInst(svc.routekey(), instnid, instnkey, props, zones,
	    250, function (err) {
		mod_assert.ok(!err);
		mod_assert.equal(mod1.ninstns, expected_mod1);
		mod_assert.equal(mod2.ninstns, expected_mod2);
		mod_tl.advance();
	});
}

function do_disable(instnid)
{
	cap.cmdDisableInst(svc.routekey(), instnid, 250, function (err) {
		if (err)
			console.error('error: %s (%j)', err.message, err);
		mod_assert.ok(!err);
		mod_assert.equal(mod1.ninstns, expected_mod1);
		mod_assert.equal(mod2.ninstns, expected_mod2);
		mod_tl.advance();
	});
}

function disable_mod1(instnid, expect_fewer)
{
	if (expect_fewer)
		expected_mod1--;

	do_disable(instnid);
}

function disable_mod2(instnid, expect_fewer)
{
	if (expect_fewer)
		expected_mod2--;

	do_disable(instnid);
}

function check_data()
{
	var after, ii, msg, time, ptime;

	after = new Date().getTime();

	mod_tl.ctStdout.info('received: %j', received_datapoints);
	mod_assert.equal(received_datapoints.length, 2);

	for (ii = 0; ii < received_datapoints.length; ii++) {
		msg = received_datapoints[ii];
		mod_assert.equal(msg.d_inst_id, instn2id);
		mod_assert.equal(msg.ca_source, svc.routekey());
		mod_assert.equal(msg.d_value, ii + 1);

		time = msg.d_time;
		mod_assert.ok(time >= before);
		mod_assert.ok(time <= after);

		if (ptime !== undefined) {
			/* These times should be pretty precise. */
			console.error('ptime = %s', ptime);
			console.error('time = %s', time);
			mod_assert.ok(time - ptime >= 975);
			mod_assert.ok(time - ptime < 1025);

			/* The difference in truncated-seconds must be 1. */
			mod_assert.equal(Math.floor(time / 1000) -
			    Math.floor(ptime / 1000), 1);
		}

		ptime = time;
	}

	received_datapoints = [];
	mod_tl.advance();
}

function check_data_double()
{
	var ii, msg, n1, n2;

	mod_tl.ctStdout.info('received: %j', received_datapoints);
	mod_assert.equal(received_datapoints.length, 4);

	n2 = 2;
	n1 = 0;
	for (ii = 0; ii < received_datapoints.length; ii++) {
		msg = received_datapoints[ii];
		if (msg.d_inst_id == instn1id) {
			mod_assert.equal(msg.d_value, ++n1);
		} else {
			mod_assert.equal(msg.d_inst_id, instn2id);
			mod_assert.equal(msg.d_value, ++n2);
		}
	}

	received_datapoints = [];
	mod_tl.advance();
}

function check_data_clear()
{
	received_datapoints = [];
	mod_tl.advance();
}

function check_data_none()
{
	mod_assert.deepEqual(received_datapoints, []);
	mod_tl.advance();
}

/*
 * Setup
 */
mod_tl.ctPushFunc(setup_svc);
mod_tl.ctPushFunc(setup_cap);
mod_tl.ctPushFunc(setup_fini);

/*
 * First, we enable an instrumentation using our main backend (mod1).  Then we
 * enable it again and make sure we *didn't* create another instrumentation
 * since this operation should be idempotent.  Then we add another
 * instrumentation to make sure we can handle concurrent ones.
 */
mod_tl.ctPushFunc(enable_mod1.bind(null, instn1id, instn1key, true));
mod_tl.ctPushFunc(enable_mod1.bind(null, instn1id, instn1key, false));
mod_tl.ctPushFunc(enable_mod1.bind(null, instn2id, instn2key, true));

/*
 * Similarly, disable the first instrumentation twice.  The second one should
 * basically be ignored.
 */
mod_tl.ctPushFunc(disable_mod1.bind(null, instn1id, true));
mod_tl.ctPushFunc(disable_mod1.bind(null, instn1id, false));

/*
 * Wait a full two seconds and then make sure we received three data points.
 */
mod_tl.ctPushFunc(mod_tl.ctSleep(2 * 1000));
mod_tl.ctPushFunc(check_data);

/*
 * Add another instrumentation, wait another 2 seconds, and make sure we get 4
 * data points that match up.  This tests concurrency, and using enable_mod2()
 * here causes us to check that we properly fall back to the second stat backend
 * when the first one can't handle the request.
 */
mod_tl.ctPushFunc(enable_mod2.bind(null, instn1id, instn1key, true));
mod_tl.ctPushFunc(mod_tl.ctSleep(2 * 1000));
mod_tl.ctPushFunc(check_data_double);

/*
 * Disable both and make sure we stop reporting values.
 */
mod_tl.ctPushFunc(disable_mod1.bind(null, instn2id, true));
mod_tl.ctPushFunc(disable_mod2.bind(null, instn1id, true));
mod_tl.ctPushFunc(check_data_clear);
mod_tl.ctPushFunc(mod_tl.ctSleep(2 * 1000));
mod_tl.ctPushFunc(check_data_none);

mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
