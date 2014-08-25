/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests having instrumenters that support different sets of metrics.
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('../../lib/ca/ca-common');
var mod_cap = require('../../lib/ca/ca-amqp-cap');
var mod_tl = require('../../lib/tst/ca-test');
var mod_metric = require('../../lib/ca/ca-metric');
var HTTP = require('../../lib/ca/http-constants');

var log = mod_tl.ctStdout;
var http_port = mod_ca.ca_http_port_config;
var url_create = '/ca/instrumentations?profile=none';
var http, aggregator, instr1, instr2;

mod_tl.ctSetTimeout(10 * 1000);

/* Metrics common to both instrumenters. */
var metric_common = {
	module: 'syscall',
	stat: 'ops',
	decomposition: [ 'f1', 'f2' ]
};

/* Metrics supported only by "instr1" */
var metric_instr1 = {
	module: 'syscall',
	stat: 'ops',
	decomposition: [ 'f2', 'f3' ]
};

/* Metrics supported only by "instr2" */
var metric_instr2 = [ {
	module: 'syscall',
	stat: 'ops',
	predicate: { eq: [ 'f4', 'foo' ] }
}, {
	module: 'instr2',
	stat: 'jobs'
} ];

/* Backend list of metrics supported by "instr1" */
var metrics1 = {
    modules: { syscall: { label: 'system calls' } },
    types: { time: { arity: 'numeric' } },
    fields: {
	f1: { label: 'field 1' },
	f2: { label: 'field 2', type: 'time' },
	f3: { label: 'field 3' }
    },
    metrics: [ {
	module: 'syscall',
	stat: 'ops',
	label: 'operations',
	unit: 'ops',
	fields: [ 'f1', 'f2', 'f3' ]
    } ]
};

/* Backend list of metrics supported by "instr2" */
var metrics2 = {
    modules: {
	syscall: { label: 'system calls' },
	instr2: { label: 'instrumenter two-specific metrics' }
    },
    types: { time: { arity: 'numeric' } },
    fields: {
	f1: { label: 'field 1' },
	f2: { label: 'field 2', type: 'time' },
	f3: { label: 'field 3' },
	f4: { label: 'field 4' }
    },
    metrics: [ {
	module: 'syscall',
	stat: 'ops',
	label: 'operations',
	unit: 'ops',
	fields: [ 'f1', 'f2', 'f4' ]
    }, {
	module: 'instr2',
	stat: 'jobs',
	label: 'instrumenter two-specific jobs',
	unit: 'jobs',
	fields: [ 'f1', 'f2', 'f3' ]
    } ]
};

/*
 * Setup test scaffolding
 */
function setup()
{
	http = new mod_tl.ctHttpRequester(http_port);
	instr1 = new mod_tl.ctDummyInstrumenter(metrics1);
	instr2 = new mod_tl.ctDummyInstrumenter(metrics2);
	aggregator = new mod_tl.ctDummyAggregator();

	mod_tl.ctInitConfigServices(function () {
	    caRunParallel([
		function (callback) { instr1.start(callback); },
		function (callback) { instr2.start(callback); },
		function (callback) { aggregator.start(callback); }
	    ], mod_tl.advance);
	});
}

mod_tl.ctPushFunc(setup);

/*
 * Check an instrumentation common to both.
 */
function check_common()
{
	enable_metric(metric_common, [ 'instr1', 'instr2' ], mod_tl.advance);
}

mod_tl.ctPushFunc(check_common);

/*
 * Check an instrumentation that only instr1 provides.
 */
function check_instr1()
{
	enable_metric(metric_instr1, [ 'instr1' ], mod_tl.advance);
}

mod_tl.ctPushFunc(check_instr1);

/*
 * Check an instrumentation that only instr2 provides.
 */
function check_instr2_fields()
{
	enable_metric(metric_instr2[0], [ 'instr2' ], mod_tl.advance);
}

mod_tl.ctPushFunc(check_instr2_fields);

/*
 * Ditto, but in this case it's not just a field that's not supported but a
 * whole module.
 */
function check_instr2_module()
{
	enable_metric(metric_instr2[1], [ 'instr2' ], mod_tl.advance);
}

mod_tl.ctPushFunc(check_instr2_module);

/*
 * Check another instrumentation common for both in case the first worked by
 * lucky timing.
 */
mod_tl.ctPushFunc(check_common);

/*
 * Given a particular "metric", create an instrumentation for it and check that
 * the expected instrumenters are enabled.  Invokes "callback" on completion.
 */
function enable_metric(metric, expected_instrs, callback)
{
	var enabled1 = instr1.nenabled();
	var enabled2 = instr2.nenabled();

	http.sendAsJson('POST', url_create, metric, true,
	    function (err, response, rv) {
		ASSERT(!err);
		mod_assert.equal(response.statusCode, HTTP.CREATED);

		mod_tl.ctTimedCheck(function (subcallback) {
			var ret = [];
			if (instr1.nenabled() > enabled1)
				ret.push('instr1');
			if (instr2.nenabled() > enabled2)
				ret.push('instr2');
			mod_assert.deepEqual(ret, expected_instrs.sort());
			subcallback();
		}, callback, 20, 250);
	    });
}

mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
