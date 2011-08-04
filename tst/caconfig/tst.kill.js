/*
 * tst.kill.js: tests that configuration changes persist across a bounce of both
 *     the configuration service and the stash service.
 */

/*
 * This test case tests the following behavior:
 *
 *    o instn creations are persisted across a bounce (and aggregators and
 *      instrumenters are correctly re-enabled after a bounce)
 *
 *    o instn destroys are persisted across a bounce
 *
 *    o instn setprops are persisted across a bounce
 *
 *    o these operations fail with 503 while the stash is down
 *
 * We do this using the primitives defined above, described here for reference:
 *
 *    setup_initial		Used to set up and tear down the config and
 *    setup_again		stash services.
 *    setup_stash
 *    teardown
 *    teardown_stash
 *    check_modules
 *    check_http_down
 *    check_amqp_down
 *
 *    check_preteardown		Used to check aggr and instr state before and
 *    check_postbringup		after a bounce.
 *
 *    create_one		Create instns, destroy instns, and check the
 *    destroy_one		current server state.  When creating, we
 *    check_list		always check that the ids are monitonically
 *    modify_one		increasing, even across a bounce, since the
 *    check_props_*		persistent state should guarantee this.
 *
 *    				We keep a queue of created instrumentations and
 *    				frequently check this against what the server
 *    				knows about.  destroy_one always destroys the
 *    				most recently created instrumentation by popping
 *    				it off the stack.
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;
var mod_stash = require('../../lib/ca/ca-svc-stash');
var mod_ca = require('../../lib/ca/ca-common');
var mod_calog = require('../../lib/ca/ca-log');
var mod_cap = require('../../lib/ca/ca-amqp-cap');
var mod_tl = require('../../lib/tst/ca-test');
var HTTP = require('../../lib/ca/http-constants');

var log = mod_tl.ctStdout;
var http_port = mod_ca.ca_http_port_config;
var url_create = '/ca/instrumentations?profile=none&module=test_module&' +
    'stat=ops1';

var svcs, aggr, instr, requester;
var stash = true;
var capcount = 0;
var ntotal = 0;
var instns = [];

mod_tl.ctSetTimeout(90 * 1000);

/*
 * Initial setup: launch dummy aggregator and instrumenter in addition to the
 * config and stash services.
 */
function setup_initial()
{
	var stages;

	aggr = new mod_tl.ctDummyAggregator();
	instr = new mod_tl.ctDummyInstrumenter();
	requester = new mod_tl.ctHttpRequester(http_port, 'localhost',
	    mod_calog.caLogNull());

	stages = [];
	stages.push(function (unused, next) {
		mod_tl.ctInitConfigServices(function (rsvcs) {
			svcs = rsvcs;
			next();
		});
	});
	stages.push(function (unused, next) { aggr.start(next); });
	stages.push(function (unused, next) { instr.start(next); });

	caRunStages(stages, null, mod_tl.advance);
}

/*
 * Subsequent setup: just relaunch the config and stash services.
 */
function setup_again()
{
	mod_tl.ctInitConfigServices(function (rsvcs) {
		svcs = rsvcs;
		mod_tl.advance();
	});
}

/*
 * Wait for the configsvc to know about our instrumenter's modules.  This is
 * asynchronous and may happen some time after we see that the configsvc has
 * come up.
 */
function check_modules()
{
	mod_tl.ctTimedCheck(function (callback) {
		requester.sendEmpty('GET', '/ca?profile=none', false,
		    function (err, response, rv) {
			if (err || response.statusCode != HTTP.OK ||
			    !('test_module' in rv['modules'])) {
				callback(new Error(
				    'cfgsvc not back up with modules'));
				return;
			}

			callback();
		    });
	}, mod_tl.advance, 3, 1000);
}

/*
 * Bring down the config and stash services (as part of a bounce).
 */
function teardown()
{
	ASSERT(svcs);
	ASSERT('config' in svcs);
	ASSERT('stash' in svcs);
	svcs['config'].stop(function () {
		svcs['stash'].stop(mod_tl.advance);
	});
}

/*
 * Bring down only the stash service.
 */
function teardown_stash()
{
	stash = false;
	svcs['stash'].stop(mod_tl.advance);
}

/*
 * Bring back up only the stash.
 */
function setup_stash()
{
	stash = true;
	svcs['stash'] = new mod_stash.caStashService(
	    [ mod_tl.ctTmpdir() ], mod_calog.caLog.INFO);
	svcs['stash'].start(mod_tl.advance);
}

/*
 * Verify that the configsvc is not responding on HTTP (as part of a bounce).
 */
function check_http_down()
{
	requester.sendEmpty('GET', '/ca', false, function (err) {
		ASSERT(err);
		mod_assert.equal(err.code, 'ECONNREFUSED');
		mod_tl.advance();
	});
}

/*
 * Verify that the configsvc is not responding on AMQP (as part of a bounce).
 */
function check_amqp_down()
{
	var cap, stages;

	cap = mod_tl.ctCreateCap({
	    host: process.argv[1] + '.' + process.pid + (capcount++),
	    type: 'test',
	    bind: []
	});

	stages = [];

	stages.push(function (unused, next) {
		cap.on('connected', next);
		cap.start();
	});

	stages.push(function (unused, next) {
		cap.cmdPing(cap.queue(), 1000, function (err) {
			ASSERT(!err);
			mod_tl.ctStdout.info('pinged self');
			next();
		});
	});

	stages.push(function (unused, next) {
		cap.cmdPing(mod_cap.ca_amqp_key_config, 1000, function (err) {
			ASSERT(err);
			ASSERT(err.code() == ECA_TIMEDOUT);
			mod_tl.ctStdout.info('failed to ping configsvc (good)');
			next();
		});
	});

	stages.push(function (unused, next) {
		cap.cmdPing(mod_cap.ca_amqp_key_stash, 1000, function (err) {
			ASSERT(err);
			ASSERT(err.code() == ECA_TIMEDOUT);
			mod_tl.ctStdout.info('failed to ping stash (good)');
			next();
		});
	});

	caRunStages(stages, null, mod_tl.advance);
}

/*
 * Create a new instrumentation.
 */
function create_one()
{
	requester.sendEmpty('POST', url_create, true,
	    function (err, response, rv) {
		if (!stash) {
			mod_assert.equal(response.statusCode, HTTP.ESRVUNAVAIL);
			mod_tl.ctStdout.info(
			    'failed to create instn as expected');
			mod_tl.advance();
			return;
		}

		mod_assert.equal(response.statusCode, HTTP.CREATED);

		ntotal++;

		instns.push(rv['uri']);
		mod_tl.ctStdout.info('created instn "%s"', rv['uri']);
		mod_tl.advance();
	    });
}

/*
 * Modify the 'idle-max' property of the most recently created instrumentation.
 */
function modify_one()
{
	var instn = instns[instns.length - 1];

	requester.sendAsForm('PUT', instn, { 'idle-max': 1000 },
	    true, function (err, response, data) {
		if (!stash) {
			mod_assert.equal(response.statusCode, HTTP.ESRVUNAVAIL);
			mod_tl.ctStdout.info(
			    'failed to modify instn as expected');
			mod_tl.advance();
			return;
		}

		mod_assert.equal(response.statusCode, HTTP.OK);
		mod_assert.equal(data['idle-max'], 1000);
		mod_tl.advance();
	});
}

/*
 * Verify the state of an instrumentation which hasn't been modified.
 */
function check_props_orig()
{
	var instn = instns[instns.length - 1];

	requester.sendEmpty('GET', instn, true, function (err, response, data) {
		mod_assert.equal(response.statusCode, HTTP.OK);
		mod_assert.equal(data['idle-max'], 3600);
		mod_tl.ctStdout.info('original props match');
		mod_tl.advance();
	});
}

/*
 * Verify the state of an instrumentation which has been modified.
 */
function check_props_modified()
{
	var instn = instns[instns.length - 1];

	requester.sendEmpty('GET', instn, true, function (err, response, data) {
		mod_assert.equal(response.statusCode, HTTP.OK);
		mod_assert.equal(data['idle-max'], 1000);
		mod_tl.ctStdout.info('modified props match');
		mod_tl.advance();
	});
}

/*
 * Destroy the most recently created instrumentation.
 */
function destroy_one()
{
	var instn = instns[instns.length - 1];

	mod_tl.ctStdout.info('destroying instn "%s"', instn);
	requester.sendEmpty('DELETE', instn, true, function (err, response) {
		if (!stash) {
			mod_assert.equal(response.statusCode, HTTP.ESRVUNAVAIL);
			mod_tl.ctStdout.info(
			    'failed to destroy instn as expected');
			mod_tl.advance();
			return;
		}

		instns.pop();
		mod_assert.equal(response.statusCode, HTTP.NOCONTENT);
		mod_tl.advance();
	});
}

/*
 * Verify that the instns we know about match those on the server.
 */
function check_list()
{
	requester.sendEmpty('GET', '/ca/instrumentations', true,
	    function (err, response, rv) {
		var ii, jj;

		ASSERT(!err);
		mod_assert.equal(response.statusCode, HTTP.OK);
		mod_assert.equal(instns.length, rv.length);

		for (ii = 0; ii < rv.length; ii++) {
			for (jj = 0; jj < instns.length; jj++) {
				if (rv[ii]['uri'] == instns[jj])
					break;
			}

			if (jj == instns.length)
				throw (new Error(caSprintf(
				    'found unexpected "%s" (%j, %j)',
				    rv[ii]['uri'], rv, instns)));
		}

		mod_tl.ctStdout.info('current state matches (%d instns)',
		    instns.length);
		mod_tl.advance();
	    });
}

var aggr_enabled_prev;
var instr_enabled_prev;
var instr_disabled_prev;

/*
 * Verify the instrumenter and aggregator state before the first teardown.  This
 * is required so that the postbringup check is valid.
 */
function check_preteardown()
{
	mod_tl.ctTimedCheck(function (callback) {
		mod_tl.ctStdout.info('check aggr/instr state at teardown');

		/*
		 * We should ultimately see 3 or 4 enablings on the aggregator:
		 * one for each of the instrumentations when it gets created,
		 * and one when the "nsources" property gets updated because an
		 * instrumenter has been created.  We may see a fourth if the
		 * instrumentation we deleted also got propagated to an
		 * instrumenter.
		 */
		aggr_enabled_prev = aggr.nenabled();
		mod_assert.ok(aggr_enabled_prev == 3 || aggr_enabled_prev == 4);

		/*
		 * We should see 1 or 2 enablings of the instrumenter: one for
		 * the instrumentation that stuck around, and maybe another for
		 * the one we deleted.
		 */
		instr_enabled_prev = instr.nenabled();
		mod_assert.ok(instr_enabled_prev == 1 ||
		    instr_enabled_prev == 2);

		instr_disabled_prev = instr.ndisabled();
		mod_assert.ok(instr_disabled_prev === 0 ||
		    instr_disabled_prev == 1);
		callback();
	}, mod_tl.advance, 10, 500);
}

/*
 * Verify the instrumenter and aggregator state after the first bounce.  This
 * ensures that the configsvc correctly re-enabled both of them.
 */
function check_postbringup()
{
	mod_tl.ctTimedCheck(function (callback) {
		mod_tl.ctStdout.info('check aggr/instr were reenabled');
		mod_assert.equal(aggr.nenabled(), aggr_enabled_prev + 2);
		mod_assert.equal(instr.nenabled(), instr_enabled_prev + 1);
		mod_assert.equal(instr.ndisabled(), instr_disabled_prev);
		callback();
	}, mod_tl.advance, 10, 500);
}

/*
 * Make sure we've created as many instrumentations as we expect and we've
 * destroyed them all.
 */
function check_final()
{
	mod_assert.equal(instns.length, 0);
	mod_assert.equal(8, ntotal);
	mod_tl.advance();
}

/*
 * This is a fairly simple test but it's made by composing of a few different
 * primitives in a somewhat complex way.  See the comment at the top of this
 * file for an explanation of what we're trying to test here and what each of
 * these functions does.
 */
mod_tl.ctPushFunc(setup_initial);	/* initial setup */
mod_tl.ctPushFunc(check_modules);

mod_tl.ctPushFunc(create_one);		/* check creation across bounce */
mod_tl.ctPushFunc(check_list);
mod_tl.ctPushFunc(destroy_one);
mod_tl.ctPushFunc(check_list);
mod_tl.ctPushFunc(create_one);
mod_tl.ctPushFunc(check_list);

mod_tl.ctPushFunc(check_preteardown);	/* bounce */
mod_tl.ctPushFunc(teardown);
mod_tl.ctPushFunc(check_http_down);
mod_tl.ctPushFunc(check_amqp_down);
mod_tl.ctPushFunc(setup_again);
mod_tl.ctPushFunc(check_modules);
mod_tl.ctPushFunc(check_postbringup);

mod_tl.ctPushFunc(check_list);		/* verify */
mod_tl.ctPushFunc(create_one);
mod_tl.ctPushFunc(check_list);
mod_tl.ctPushFunc(destroy_one);
mod_tl.ctPushFunc(check_list);

mod_tl.ctPushFunc(destroy_one);		/* check destroy across bounce */
mod_tl.ctPushFunc(check_list);

mod_tl.ctPushFunc(teardown);		/* bounce */
mod_tl.ctPushFunc(check_http_down);
mod_tl.ctPushFunc(check_amqp_down);
mod_tl.ctPushFunc(setup_again);
mod_tl.ctPushFunc(check_modules);
mod_tl.ctPushFunc(check_list);		/* verify */

mod_tl.ctPushFunc(create_one);		/* check modify across bounce */
mod_tl.ctPushFunc(check_props_orig);
mod_tl.ctPushFunc(modify_one);
mod_tl.ctPushFunc(check_list);
mod_tl.ctPushFunc(check_props_modified);

mod_tl.ctPushFunc(teardown);		/* bounce */
mod_tl.ctPushFunc(check_http_down);
mod_tl.ctPushFunc(check_amqp_down);
mod_tl.ctPushFunc(setup_again);
mod_tl.ctPushFunc(check_modules);
mod_tl.ctPushFunc(check_list);		/* verify */
mod_tl.ctPushFunc(check_props_modified);
mod_tl.ctPushFunc(destroy_one);
mod_tl.ctPushFunc(check_list);

mod_tl.ctPushFunc(create_one);		/* check modification with stash down */
mod_tl.ctPushFunc(create_one);
mod_tl.ctPushFunc(teardown_stash);

mod_tl.ctPushFunc(create_one);
mod_tl.ctPushFunc(check_list);
mod_tl.ctPushFunc(destroy_one);
mod_tl.ctPushFunc(check_list);
mod_tl.ctPushFunc(check_props_orig);
mod_tl.ctPushFunc(modify_one);
// mod_tl.ctPushFunc(check_props_orig);	// XXX should work

mod_tl.ctPushFunc(setup_stash);
mod_tl.ctPushFunc(check_list);
mod_tl.ctPushFunc(create_one);
mod_tl.ctPushFunc(check_list);
mod_tl.ctPushFunc(destroy_one);
mod_tl.ctPushFunc(check_list);
mod_tl.ctPushFunc(create_one);
mod_tl.ctPushFunc(check_props_orig);
mod_tl.ctPushFunc(modify_one);
mod_tl.ctPushFunc(check_props_modified);

mod_tl.ctPushFunc(destroy_one);		/* cleanup */
mod_tl.ctPushFunc(destroy_one);
mod_tl.ctPushFunc(destroy_one);

mod_tl.ctPushFunc(check_final);		/* final checks */
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
