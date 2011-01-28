/*
 * Tests the basic sequence of creating, viewing, listing, and deleting
 * instrumentations against the configuration service.
 */

var mod_querystring = require('querystring');
var ASSERT = require('assert');

var mod_ca = require('../../lib/ca/ca-common');
var mod_tl = require('../../lib/tst/ca-test');
var HTTP = require('../../lib/ca/http-constants');

var log = mod_tl.ctStdout;
var http_port = mod_ca.ca_http_port_config;
var url_create = '/ca/instrumentations';
var instrumenter, aggregator, http;

mod_tl.ctSetTimeout(10 * 1000);

/*
 * Checks that the given object is a representation of a server-side error.
 */
function assertError(obj)
{
	ASSERT.ok(obj.constructor == Object);
	ASSERT.ok('error' in obj);
}

/*
 * Check that the given object does not represent a server-side error.
 */
function assertNoError(obj)
{
	ASSERT.ok(obj.constructor != Object || !('error' in obj));
}

/*
 * Invoked during one of our stages after we've dispatched all of our requests.
 * If there are no more pending requests, then advance to the next stage.
 */
function check_stage_done()
{
	if (!http.hasPendingRequests()) {
		log.info('STAGE COMPLETE');
		mod_tl.advance();
	}
}

/*
 * Check whether the given HTTP "response" and "rv" correctly match what we
 * would expect for the instrumentation specified by the given test.  Also check
 * the HTTP status code, which may be either 200 (OK) or 201 (Created) depending
 * on our caller.
 */
function check_instrumentation(test, code, response, rv)
{
	var inp, exp, decomp, key, pred, trans;

	inp = test.input;
	decomp = inp.decomposition || [];
	if (decomp.constructor == String)
		decomp = [ decomp ];
	pred = inp.predicate || {};
	if (pred.constructor != String)
		pred = JSON.stringify(pred);
	trans = inp.transformations || {};

	ASSERT.equal(response.statusCode, code);
	assertNoError(rv);
	ASSERT.equal(rv['module'], inp['module']);
	ASSERT.equal(rv['stat'], inp['stat']);
	ASSERT.deepEqual(rv['decomposition'], decomp);
	ASSERT.equal(rv['predicate'], pred);
	ASSERT.equal(rv['retention-time'], 600);
	ASSERT.equal(rv['enabled'], true);

	exp = test.expect || {};
	for (key in test.expect) {
		ASSERT.equal(rv[key], exp[key],
		    'key ' + key + ' didn\'t match.');
	}
}

/*
 * The following test cases drive most of this test.  Each one represents a
 * potential instrumentation to be created with the 'input' field.  If 'error'
 * is present, then the instrumentation is not valid and attempted creation
 * should fail with the specified error code.  Otherwise if 'expect' is present,
 * it defines variable pieces of the expected representation.  For the test
 * cases defining valid instrumentations, the instrumentation is saved and
 * several subsequent stages validate that other operations do the right thing
 * (e.g., GET on the instrumentation, GET on the instrumentation list, etc.).
 */
var http_test_cases = [ {
	name: 'missing required "stat" field',
	input: { module: 'test_module' },
	error: HTTP.EBADREQUEST
}, {
	name: 'missing required "module" field',
	input: { stat: 'test_module' },
	error: HTTP.EBADREQUEST
}, {
	name: 'invalid module name',
	input: { module: 'test_module_wrong', stat: 'ops1' },
	error: HTTP.EBADREQUEST
}, {
	name: 'invalid stat name',
	input: { module: 'test_module', stat: 'ops2' },
	error: HTTP.EBADREQUEST
}, {
	name: 'invalid module type',
	input: { module: {}, stat: 'ops1' },
	error: HTTP.EBADREQUEST
}, {
	name: 'invalid stat type',
	input: { module: 'test_module', stat: {} },
	error: HTTP.EBADREQUEST
}, {
	name: 'illegal predicate: invalid key',
	input: { module: 'test_module', stat: 'ops1', predicate: { junk: [] } },
	error: HTTP.EBADREQUEST
}, {
	name: 'illegal predicate: too few args to "eq"',
	input: { module: 'test_module', stat: 'ops1', predicate: { eq: [] } },
	error: HTTP.EBADREQUEST
}, {
	name: 'illegal predicate: wrong type',
	input: { module: 'test_module', stat: 'ops1', predicate: 'blah' },
	error: HTTP.EBADREQUEST
}, {
	name: 'illegal decomposition: illegal field',
	input: { module: 'test_module', stat: 'ops1', decomposition: ['junk'] },
	error: HTTP.EBADREQUEST
}, {
	name: 'create with simple metric',
	input: { module: 'test_module', stat: 'ops1' },
	expect: { 'value-dimension': 1, 'value-arity': 'scalar' }
}, {
	name: 'create with single discrete decomposition',
	input: { module: 'test_module', stat: 'ops1',
	    decomposition: 'hostname' },
	expect: { 'value-dimension': 2,
	    'value-arity': 'discrete-decomposition' }
}, {
	name: 'create with single numeric decomposition',
	input: { module: 'test_module', stat: 'ops1',
	    decomposition: 'latency' },
	expect: { 'value-dimension': 2, 'value-arity': 'numeric-decomposition' }
}, {
	name: 'create with double numeric decomposition',
	input: { module: 'test_module', stat: 'ops1',
	    decomposition: ['hostname', 'latency'] },
	expect: { 'value-dimension': 3, 'value-arity': 'numeric-decomposition' }
},  {
	name: 'create with simple metric and simple predicate',
	input: {
	    module: 'test_module',
	    stat: 'ops1',
	    predicate: { eq: ['hostname', 'foo' ] }
	},
	expect: { 'value-dimension': 1, 'value-arity': 'scalar' }
},  {
	name: 'create with simple metric and complex predicate',
	input: {
	    module: 'test_module',
	    stat: 'ops1',
	    predicate: { and:
		[ { eq: ['hostname', 'foo' ] }, { gt: ['latency', 20 ] } ]
	    }
	},
	expect: { 'value-dimension': 1, 'value-arity': 'scalar' }
} ];

/*
 * Returns a function that invokes "walker" on each of the above test cases.
 * Because of Javascript scoping rules and the fact that operating on each test
 * case involves making an asynchronous request and referring back to the
 * original test case from inside the handler, doing the walker work inside a
 * loop is nasty.
 *
 * The walker is given two arguments: the test case and a callback.  The
 * callback should be invoked when the walker is finished, after all
 * asynchronous HTTP requests have been completed.  However, the walker may
 * invoke the callback multiple times as long as there are still pending
 * requests and the callback is invoked again when those requests complete.
 *
 * The function returned by walk_testcases assumes that it's the body of one
 * stage of the test run.  That is, there must be no previous HTTP requests
 * pending when it's invoked, and when all of its requests have been completed
 * it will advance to the next stage.  The extra level of indirection here
 * (returning a function) allows a call to walk_testcases(somewalker) to be
 * pushed onto the queue.
 */
function walk_testcases(walker)
{
	var rv = function () {
		var ii;

		for (ii = 0; ii < http_test_cases.length; ii++) {
			walker(http_test_cases[ii], function () {
				if (ii == http_test_cases.length)
					check_stage_done();
			});
		}
	};

	rv.caFunctionName = 'walk_testcases: ' + walker.name;
	return (rv);
}

/*
 * Stage: setup test scaffolding
 */
function setup()
{
	http = new mod_tl.ctHttpRequester(http_port);
	instrumenter = new mod_tl.ctDummyInstrumenter();
	aggregator = new mod_tl.ctDummyAggregator();
	mod_tl.ctWaitForAmqpService(mod_ca.ca_amqp_key_config, function () {
		instrumenter.start(function () {
			aggregator.start(mod_tl.advance);
		});
	});
}

mod_tl.ctPushFunc(setup);

/*
 * Stage: check various global URIs for starting state
 */
function check_global_uris()
{
	/* /junk should not exist. */
	http.sendEmpty('GET', '/junk', true, function (err, response, rv) {
		ASSERT.ok(response.statusCode == HTTP.ENOTFOUND);
		assertError(rv);
		check_stage_done();
	});

	/* /ca/metrics should exist with the correct metrics. */
	http.sendEmpty('GET', '/ca/metrics', true,
	    function (err, response, rv) {
		var mod = rv['test_module'], stat = mod['stats']['ops1'];
		var fields = stat['fields'];

		ASSERT.ok(response.statusCode == HTTP.OK);
		ASSERT.ok(mod['label'] == 'test module description');
		ASSERT.ok(stat['label'] == 'test ops 1');
		ASSERT.ok(stat['type'] == 'ops');
		ASSERT.ok(fields['hostname']['type'] == mod_ca.ca_type_string);
		ASSERT.ok(fields['hostname']['label'] == 'server host name');
		ASSERT.ok(fields['latency']['type'] == mod_ca.ca_type_latency);
		ASSERT.ok(fields['latency']['label'] ==
		    'duration of operation');
		check_stage_done();
	});

	/* /ca/instrumentations should report nothing. */
	http.sendEmpty('GET', '/ca/instrumentations', true,
	    function (err, response, rv) {
		ASSERT.ok(response.statusCode == HTTP.OK);
		ASSERT.ok(rv.length === 0);
		check_stage_done();
	});

	/* Cannot POST with no data */
	http.sendEmpty('POST', url_create, true, function (err, response, rv) {
		ASSERT.equal(response.statusCode, HTTP.EBADREQUEST);
		assertError(rv);
		check_stage_done();
	});

	/* Cannot PUT to create */
	http.sendEmpty('PUT', url_create, true, function (err, response, rv) {
		ASSERT.equal(response.statusCode, HTTP.ENOTFOUND);
		assertError(rv);
		check_stage_done();
	});
}

mod_tl.ctPushFunc(check_global_uris);

/*
 * Stage: run through the test cases trying to create the corresponding
 * instrumentation and check that we get the expected result.
 */
function walk_create(test, callback)
{
	var handler = function (err, response, rv) {
		log.info('received POST response for test: %s', test.name);
		ASSERT.ok(!err);

		if (test.error) {
			ASSERT.ok(!test.expect);
			ASSERT.equal(response.statusCode, test.error);
			assertError(rv);
		} else {
			check_instrumentation(test, HTTP.CREATED, response, rv);
			if (!test.instrumentations)
				test.instrumentations = [];
			test.instrumentations.push(rv);
		}

		callback();
	};

	/*
	 * We try both the HTTP form and JSON interfaces to make sure both are
	 * working, but we need to specially encode the 'predicate' field for
	 * the forms interface because it's the only field that itself could be
	 * a non-trivial JSON object that sendAsForm doesn't already know how to
	 * encode.
	 */
	http.sendAsJson('POST', url_create, test.input, true, handler);

	test.input.predicate = JSON.stringify(test.input.predicate);
	http.sendAsForm('POST', url_create, test.input, true, handler);
}

mod_tl.ctPushFunc(walk_testcases(walk_create));

/*
 * Stage: go through the instrumentations we just created and verify that doing
 * a GET on each's URI returns the same data as we got when we created it.
 */
function walk_get(test, callback)
{
	var ii;
	var handler = function (err, response, rv) {
		log.info('received GET response for test: %s', test.name);
		ASSERT.ok(!err);
		check_instrumentation(test, HTTP.OK, response, rv);
		callback();
	};

	if (!test.instrumentations) {
		callback();
		return;
	}

	for (ii = 0; ii < test.instrumentations.length; ii++)
		http.sendEmpty('GET', test.instrumentations[ii].uri, true,
		    handler);
}

mod_tl.ctPushFunc(walk_testcases(walk_get));

/*
 * Stage: list all instrumentations and compare to what we expect.
 */
function list_instrumentations()
{
	var ii, jj, test;
	var byuri = {};

	for (ii = 0; ii < http_test_cases.length; ii++) {
		test = http_test_cases[ii];

		if (!test.instrumentations)
			continue;

		for (jj = 0; jj < test.instrumentations.length; jj++)
			byuri[test.instrumentations[jj].uri] = test;
	}

	http.sendEmpty('GET', '/ca/instrumentations', true,
	    function (err, response, rv) {
		ASSERT.ok(response.statusCode == HTTP.OK);

		for (ii = 0; ii < rv.length; ii++) {
			test = byuri[rv[ii].uri];

			if (!test) {
				log.error('unexpected instrumentation: %j',
				    rv[ii]);
				throw (new Error('unexpected instrumentation'));
			}

			check_instrumentation(test, HTTP.OK, response, rv[ii]);
			delete (byuri[rv[ii].uri]);
		}

		for (ii in byuri) {
			log.error('missing instrumentation: %j', byuri[ii]);
			throw (new Error('missing instrumentation'));
		}

		check_stage_done();
	});
}

mod_tl.ctPushFunc(list_instrumentations);

/*
 * Stage: delete the instrumentations we've created.
 */
function walk_delete(test, callback)
{
	var ii;
	var handler = function (err, response, rv) {
		log.info('received DELETE response for test: %s', test.name);
		ASSERT.ok(!err);
		ASSERT.equal(response.statusCode, HTTP.OK);
		callback();
	};

	if (!test.instrumentations) {
		callback();
		return;
	}

	for (ii = 0; ii < test.instrumentations.length; ii++)
		http.sendEmpty('DELETE', test.instrumentations[ii].uri, true,
		    handler);
}

mod_tl.ctPushFunc(walk_testcases(walk_delete));

/*
 * Stage: verify the deleted instrumentations are gone.
 */
function walk_check_gone(test, callback)
{
	var ii;
	var handler = function (err, response, rv) {
		log.info('received GET response for test: %s', test.name);
		ASSERT.ok(!err);
		ASSERT.equal(response.statusCode, HTTP.ENOTFOUND);
		callback();
	};

	if (!test.instrumentations) {
		callback();
		return;
	}

	for (ii = 0; ii < test.instrumentations.length; ii++)
		http.sendEmpty('GET', test.instrumentations[ii].uri, true,
		    handler);
}

mod_tl.ctPushFunc(walk_testcases(walk_check_gone));

/*
 * Stage: check that we don't have any outstanding requests remaining.  This
 * would indicate a bug in this test script.
 */
function final_check()
{
	ASSERT.ok(!http.hasPendingRequests());

	http.sendEmpty('GET', '/ca/instrumentations', true,
	    function (err, response, rv) {
		ASSERT.ok(response.statusCode == HTTP.OK);
		ASSERT.ok(rv.length === 0);
		check_stage_done();
	});
}

mod_tl.ctPushFunc(final_check);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
