/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests cloning instrumentations.
 */

var ASSERT = require('assert');

var mod_ca = require('../../lib/ca/ca-common');
var mod_tl = require('../../lib/tst/ca-test');
var HTTP = require('../../lib/ca/http-constants');

var log = mod_tl.ctStdout;
var http_port = mod_ca.ca_http_port_config;
var url_create = '/ca/instrumentations?profile=none';
var url_clone;

var instrumenter, aggregator, http, svcs;
var cc, instns = {};

mod_tl.ctSetTimeout(10 * 1000);

/*
 * The "initial" instrumentation is what we'll use as the basis for cloning.  We
 * set all mutable fields to non-default values so that we can tell when cloning
 * that the template's field value, not the defaults, are used in the clone for
 * all fields.
 */
var instn_initial = {
    input: {
	module: 'test_module',
	stat: 'ops1',
	decomposition: [ 'hostname' ],
	predicate: { eq: [ 'hostname', 'foo' ] },
	'idle-max': 2000,
	'retention-time': 3000,
	'persist-data': true,
	granularity: 5
    },
    value: {
	module: 'test_module',
	stat: 'ops1',
	decomposition: [ 'hostname' ],
	predicate: { eq: [ 'hostname', 'foo' ] },
	'idle-max': 2000,
	'retention-time': 3000,
	'persist-data': true,
	granularity: 5,
	'value-dimension': 2,
	'value-arity': 'discrete-decomposition',
	'value-scope': 'interval',
	enabled: true,
	transformations: []
    }
};

/*
 * This list of clones is essentially the list of test cases.  In each case,
 * we'll clone the above "initial" instrumentation with the specified
 * "props" overriding and expect "value".
 */
var instn_clones = [ {
    name: 'default clone',
    props: {},
    value: instn_initial.value
}, {
    name: 'modify one field',
    props: {
	decomposition: [ 'latency' ]
    },
    value: {
	module: 'test_module',
	stat: 'ops1',
	decomposition: [ 'latency' ],
	predicate: { eq: [ 'hostname', 'foo' ] },
	'idle-max': 2000,
	'retention-time': 3000,
	'persist-data': true,
	granularity: 5,
	'value-dimension': 2,
	'value-arity': 'numeric-decomposition',
	'value-scope': 'interval',
	enabled: true,
	transformations: []
    }
}, {
    name: 'modify all fields',
    props: {
	module: 'test_module',
	stat: 'ops1',
	decomposition: [ 'hostname', 'latency' ],
	predicate: { eq: [ 'hostname', 'bar' ] },
	'idle-max': 1000,
	'retention-time': 4000,
	'persist-data': false,
	granularity: 10
    },
    value: {
	module: 'test_module',
	stat: 'ops1',
	decomposition: [ 'hostname', 'latency' ],
	predicate: { eq: [ 'hostname', 'bar' ] },
	'idle-max': 1000,
	'retention-time': 4000,
	'persist-data': false,
	granularity: 10,
	'value-dimension': 3,
	'value-arity': 'numeric-decomposition',
	'value-scope': 'interval',
	enabled: true,
	transformations: []
    }
} ];

/*
 * Creates an instrumentation, verifies the resulting "crtime" field and other
 * common values, removes unpredictable values (e.g., uri, id, crtime), and
 * compares it to the "expected" value.  If any of these checks fail, the test
 * blows up.
 */
function create_instn(url, input, expected, callback)
{
	var before, after;

	log.info('creating instrumentation %s %j', url, input);
	before = new Date().getTime();
	http.sendAsJson('POST', url, input, true, function (err, response, rv) {
		var val;

		ASSERT.equal(response.statusCode, HTTP.CREATED);
		val = caDeepCopy(rv);
		after = new Date().getTime();

		ASSERT.ok(before <= val['crtime']);
		ASSERT.ok(val['crtime'] <= after);
		delete (val['crtime']);

		delete (val['uri']);
		delete (val['uris']);
		delete (val['id']);
		delete (val['nsources']);

		ASSERT.deepEqual(expected, val);
		delete (rv['nsources']);
		instns[rv['uri']] = rv;
		callback(rv);
	    });
}

/*
 * Stage: lists all instrumentations and compares them to our expected values.
 * This ensures that cloning one instrumentation doesn't change any others.
 */
function check_instns()
{
	var uri, ii;
	var count = 0;

	for (uri in instns)
		count++;

	http.sendEmpty('GET', '/ca/instrumentations', true,
	    function (err, response, rv) {
		ASSERT.ok(response.statusCode == HTTP.OK);
		ASSERT.equal(count, rv.length);

		for (ii = 0; ii < rv.length; ii++) {
			ASSERT.ok(rv[ii]['uri'] in instns,
			    caSprintf('unexpected uri "%s" in instn list',
			    rv[ii]['uri']));

			delete (rv[ii]['nsources']);
			console.error(rv[ii]);
			console.error(instns[rv[ii]['uri']]);
			ASSERT.deepEqual(rv[ii], instns[rv[ii]['uri']]);
		}

		mod_tl.advance();
	});
}

/*
 * Stage: setup test scaffolding
 */
function setup()
{
	http = new mod_tl.ctHttpRequester(http_port);
	instrumenter = new mod_tl.ctDummyInstrumenter();
	aggregator = new mod_tl.ctDummyAggregator();
	mod_tl.ctInitConfigServices(function (rsvcs) {
		svcs = rsvcs;
		instrumenter.start(function () {
			aggregator.start(mod_tl.advance);
		});
	});
}

/*
 * Stage: creates the initial instrumentation that will be the template for our
 * clones.
 */
function create_one()
{
	create_instn(url_create, instn_initial.input, instn_initial.value,
	    function (rv) {
		url_clone = rv['uri'] + '/clone?profile=none';
		mod_tl.advance();
	    });
}

/*
 * Stage [template]: create a new clone.  All we do here is create a clone
 * according to the given specification and check that it matches what we
 * expect.
 */
function create_clone(clone)
{
	ASSERT.ok(url_clone);
	ASSERT.ok(clone.props);
	ASSERT.ok(clone.value);
	create_instn(url_clone, clone.props, clone.value, mod_tl.advance);
}

/*
 * Stage: try creating a clone with invalid values and make sure it fails.
 */
function illegal_clone()
{
	http.sendAsJson('POST', url_clone, { granularity: 'foo' }, false,
	    function (err, response, rv) {
		ASSERT.equal(response.statusCode, HTTP.ECONFLICT);
		mod_tl.advance();
	    });
}

/*
 * Stage: tear down services.
 */
function teardown()
{
	svcs['stash'].stop(function () {
		svcs['config'].stop(mod_tl.advance);
	});
}

mod_tl.ctPushFunc(setup);
mod_tl.ctPushFunc(check_instns);
mod_tl.ctPushFunc(create_one);
mod_tl.ctPushFunc(check_instns);

for (cc = 0; cc < instn_clones.length; cc++) {
	mod_tl.ctPushFunc(create_clone.bind(null, instn_clones[cc]));
	mod_tl.ctPushFunc(check_instns);
}

mod_tl.ctPushFunc(illegal_clone);
mod_tl.ctPushFunc(teardown);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);

mod_tl.advance();
